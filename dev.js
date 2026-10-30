import app from './server.js';
app.listen(process.env.PORT || 3000, '127.0.0.1', () => console.log(`Woningzoeker: http://localhost:${process.env.PORT || 3000}`));
