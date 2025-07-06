import express, { type Request, type Response } from 'express';
import path from 'path';

const app = express();

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// Serve the main HTML file
app.get('/', (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start the server
const PORT = 8081;
// const PORT = 2000;
// const PORT = 2100;
app.listen(PORT, () => {
    console.log(`Frontend server running on http://localhost:${PORT}`);
}); 
