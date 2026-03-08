import express from 'express';
import healthRouter from './routes/health';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', healthRouter);

export default app;
