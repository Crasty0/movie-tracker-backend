// javascript - server.js (Versiune FINALĂ cu Izolare Pe Utilizator)

const Koa = require('koa');
const app = new Koa();
const server = require('http').createServer(app.callback());
const WebSocket = require('ws');
const wss = new WebSocket.Server({ server });
const Router = require('koa-router');
const cors = require('koa2-cors');
const bodyparser = require('koa-bodyparser');

app.use(bodyparser());
app.use(cors({ origin: '*' }));

// ----------------------------------------------------------------------
// 1. CONFIGURARE MULTI-USER ȘI AUTENTIFICARE
// ----------------------------------------------------------------------

const USERS = [ // Lista de utilizatori multipli
    { username: 'david', password: '123' },
    { username: 'david2', password: '123' },
    { username: 'web', password: 'password' }
];

// Funcție pentru a genera un token, incluzând numele de utilizator.
const generateToken = (username) => {
    return `token_${username}`;
}

// Rută de login
const authRouter = new Router();
authRouter.post('/api/auth/login', async (ctx) => {
    const { username, password } = ctx.request.body;
    const user = USERS.find(u => u.username === username && u.password === password);

    if (user) {
        ctx.body = { token: generateToken(username) };
        ctx.status = 200;
    } else {
        ctx.body = { message: 'Invalid credentials' };
        ctx.status = 401;
    }
});

// Middleware de Autorizare (Extrage username-ul din token și îl validează)
const jwt = async (ctx, next) => {
    const header = ctx.request.headers.authorization;
    if (header) {
        const parts = header.split(' ');
        // NOU: Verificăm prefixul token_ și extragem username-ul
        if (parts.length === 2 && parts[0] === 'Bearer' && parts[1].startsWith('token_')) {
            const username = parts[1].substring('token_'.length);

            if (USERS.some(u => u.username === username)) {
                // ATASĂM USER ID LA CONTEXT
                ctx.state.user = { id: username };
                await next();
                return;
            }
        }
    }
    ctx.status = 401;
    ctx.body = { message: 'Authentication required' };
};

// ----------------------------------------------------------------------
// 2. LOGICĂ COMUNĂ
// ----------------------------------------------------------------------

app.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    console.log(`${ctx.method} ${ctx.url} ${ctx.status || ctx.response.status} - ${ms}ms`);
});

app.use(async (ctx, next) => {
    await new Promise(resolve => setTimeout(resolve, 200));
    await next();
});

app.use(async (ctx, next) => {
    try {
        await next();
    } catch (err) {
        ctx.status = err.status || 500;
        ctx.body = { message: err.message || 'Unexpected error' };
    }
});

// ----------------------------------------------------------------------
// 3. LOGICA FILME (Model și Date cu userId)
// ----------------------------------------------------------------------

class Movie {
    // NOU: Adăugat userId
    constructor({ id, nume, launchDate, rating, watched, version, userId }) {
        this.id = id;
        this.nume = nume;
        this.launchDate = launchDate;
        this.rating = rating;
        this.watched = watched;
        this.version = version;
        this.userId = userId; // NOU
    }
}

const movies = [];
// Inițializăm filmele și le asociem utilizatorilor diferiți
for (let i = 0; i < 2; i++) {
    movies.push(new Movie({
        id: `${i}`,
        nume: `david's movie ${i}`,
        launchDate: '',
        rating: 0,
        watched: false,
        version: 1,
        userId: USERS[0].username // David deține filmele 0, 1
    }));
}
for (let i = 2; i < 4; i++) {
    movies.push(new Movie({
        id: `${i}`,
        nume: `david2's movie ${i}`,
        launchDate: '',
        rating: 0,
        watched: false,
        version: 1,
        userId: USERS[1].username // David2 deține filmele 2, 3
    }));
}

let lastId = movies[movies.length - 1].id || '3';

// MODIFICAT: Web Socket Broadcast filtrează după userId (Punctul 3 - WS)
const broadcast = data => {
    const { payload: { movie } } = data;
    wss.clients.forEach(client => {
        // Trimitem notificarea DOAR către clienții care dețin acest film (userId)
        if (client.readyState === WebSocket.OPEN && client.userId === movie.userId) {
            client.send(JSON.stringify(data));
        }
    });
};

// ----------------------------------------------------------------------
// 4. RUTARE (Rutele de filme sunt PROTEJATE ȘI FILTRATE)
// ----------------------------------------------------------------------

const router = new Router();

// Toate rutele de filme folosesc middleware-ul JWT pentru autorizare și extragerea userId
router.use(jwt);

// GET all (Punctul 3 - REST)
router.get('/movie', ctx => {
    const userId = ctx.state.user.id;
    // FILTRAREA: Returnează doar filmele care aparțin utilizatorului curent
    const userMovies = movies.filter(m => m.userId === userId);

    ctx.body = userMovies;
    ctx.status = 200;
});

// GET by id
router.get('/movie/:id', ctx => {
    const id = ctx.params.id;
    const userId = ctx.state.user.id;

    const movie = movies.find(m => m.id === id);

    // VERIFICARE: Returnează 404 dacă nu este găsit sau 403 dacă nu îi aparține
    if (movie && movie.userId === userId) {
        ctx.body = movie;
        ctx.status = 200;
    } else {
        ctx.body = { message: `movie with id ${id} not found or unauthorized` };
        ctx.status = 404;
    }
});

// create helper
const createMovie = async (ctx) => {
    const userId = ctx.state.user.id; // Preluăm userId-ul curent
    const movie = ctx.request.body || {};
    if (!movie.nume) {
        ctx.body = { message: 'nume is missing' };
        ctx.status = 400;
        return;
    }
    movie.id = `${parseInt(lastId, 10) + 1}`;
    lastId = movie.id;
    movie.launchDate = movie.launchDate || '';
    movie.rating = movie.rating || 0;
    movie.watched = !!movie.watched;
    movie.version = 1;
    movie.userId = userId; // SETĂM PROPRIETARUL FILMULUI

    movies.push(movie);
    ctx.body = movie;
    ctx.status = 201;
    broadcast({ event: 'created', payload: { movie } });
};

// POST create
router.post('/movie', async (ctx) => {
    await createMovie(ctx);
});

// PUT update
router.put('/movie/:id', async (ctx) => {
    const id = ctx.params.id;
    const userId = ctx.state.user.id;
    const incoming = ctx.request.body || {};

    if (incoming.id && incoming.id !== id) {
        ctx.body = { message: 'Param id and body id should be the same' };
        ctx.status = 400;
        return;
    }

    if (!incoming.id) {
        await createMovie(ctx);
        return;
    }

    const index = movies.findIndex(m => m.id === id);
    if (index === -1) {
        ctx.body = { message: `movie with id ${id} not found` };
        ctx.status = 404;
        return;
    }

    // VERIFICARE: Asigură-te că filmul îi aparține
    if (movies[index].userId !== userId) {
        ctx.body = { message: 'Forbidden: Cannot update another user\'s movie' };
        ctx.status = 403;
        return;
    }

    const headerVersion = parseInt(ctx.get('If-Match')) || parseInt(ctx.get('ETag')) || undefined;
    const incomingVersion = Number.isInteger(headerVersion) ? headerVersion : (incoming.version || 0);

    if (incomingVersion < movies[index].version) {
        ctx.body = { message: 'Version conflict' };
        ctx.status = 409;
        return;
    }

    incoming.version = (movies[index].version || 0) + 1;
    incoming.id = id;
    incoming.userId = userId; // Păstrăm userId-ul
    incoming.launchDate = incoming.launchDate || movies[index].launchDate || '';
    incoming.rating = typeof incoming.rating === 'number' ? incoming.rating : movies[index].rating;
    incoming.watched = typeof incoming.watched === 'boolean' ? incoming.watched : movies[index].watched;

    movies[index] = incoming;
    ctx.body = incoming;
    ctx.status = 200;
    broadcast({ event: 'updated', payload: { movie: incoming } });
});

// DELETE
router.del('/movie/:id', ctx => {
    const id = ctx.params.id;
    const userId = ctx.state.user.id;
    const index = movies.findIndex(m => m.id === id);

    if (index !== -1) {
        const movie = movies[index];

        // VERIFICARE: Nu lăsa un user să șteargă filmul altui user
        if (movie.userId !== userId) {
            ctx.status = 403;
            return;
        }

        movies.splice(index, 1);
        ctx.status = 204;
        broadcast({ event: 'deleted', payload: { movie } });
        return;
    }
    ctx.status = 204;
});


// ----------------------------------------------------------------------
// 5. CONFIGURARE WEBSOCKET PENTRU AUTORIZARE ȘI USER ID
// ----------------------------------------------------------------------

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    // NOU: Verificăm token-ul bazat pe user și setăm ws.userId
    if (token && token.startsWith('token_')) {
        const userId = token.substring('token_'.length);

        if (USERS.some(u => u.username === userId)) {
            ws.userId = userId; // Stocăm userId-ul pe conexiunea WS
            console.log(`WebSocket connection authorized for user: ${userId}`);
            return;
        }
    }
    ws.close(1008, 'Unauthorized');
    console.log('WebSocket connection unauthorized');
});


app.use(authRouter.routes());
app.use(authRouter.allowedMethods());

app.use(router.routes());
app.use(router.allowedMethods());


server.listen(3000, () => console.log('Server listening on http://localhost:3000'));