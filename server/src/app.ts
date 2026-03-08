import express from 'express';
import cookieParser from 'cookie-parser';
import healthRouter from './routes/health';
import authRouter from './routes/auth';
import passwordResetRouter from './routes/passwordReset';
import icpRouter from './routes/icp';
import companiesHouseRouter from './routes/companiesHouse';
import leadsRouter from './routes/leads';
import linkedinRouter from './routes/linkedin';
import enrichmentRouter from './routes/enrichment';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/api', healthRouter);
app.use('/api', authRouter);
app.use('/api', passwordResetRouter);
app.use('/api', icpRouter);
app.use('/api', companiesHouseRouter);
app.use('/api', leadsRouter);
app.use('/api', linkedinRouter);
app.use('/api', enrichmentRouter);

export default app;
