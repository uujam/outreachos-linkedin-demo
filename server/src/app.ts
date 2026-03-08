import express from 'express';
import cookieParser from 'cookie-parser';
import healthRouter from './routes/health';
import authRouter from './routes/auth';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/api', healthRouter);
app.use('/api', authRouter);

export default app;
