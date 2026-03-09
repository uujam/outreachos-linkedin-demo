import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import healthRouter from './routes/health';
import authRouter from './routes/auth';
import passwordResetRouter from './routes/passwordReset';
import icpRouter from './routes/icp';
import companiesHouseRouter from './routes/companiesHouse';
import leadsRouter from './routes/leads';
import linkedinRouter from './routes/linkedin';
import enrichmentRouter from './routes/enrichment';
import heyreachRouter from './routes/heyreach';
import instantlyRouter from './routes/instantly';
import voiceRouter from './routes/voice';
import dashboardRouter from './routes/dashboard';
import eventsRouter from './routes/events';
import notificationsRouter from './routes/notifications';
import meetingsRouter from './routes/meetings';
import integrationsRouter from './routes/integrations';
import reportsRouter from './routes/reports';
import adminRouter from './routes/admin';
import stripeRouter from './routes/stripe';
import onboardingRouter from './routes/onboarding';

const app = express();

// ─── Security middleware ──────────────────────────────────────────────────────

// Helmet sets secure HTTP headers
app.use(helmet());

// CORS: allow only our own app origin in production
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',').map(o => o.trim());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. Stripe webhooks, server-to-server)
    if (!origin) { callback(null, true); return; }
    if (allowedOrigins.includes(origin)) { callback(null, true); return; }
    callback(new Error('CORS: Origin not allowed'));
  },
  credentials: true,
}));

// HTTPS enforcement in production: redirect HTTP to HTTPS
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    res.redirect(301, `https://${req.hostname}${req.url}`);
    return;
  }
  next();
});

// Global rate limit: 200 req/15min per IP (applied before body parsing)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down.' },
  skip: () => process.env.NODE_ENV === 'test',
});
app.use(globalLimiter);

// Stricter limiter for auth endpoints: 10 req/15min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts — please wait before trying again.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// ─── Stripe webhook needs raw body — mount before express.json() ─────────────
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// ─── Routes ──────────────────────────────────────────────────────────────────

app.use('/api', authLimiter, authRouter);        // auth routes get tighter limit
app.use('/api', authLimiter, passwordResetRouter);

app.use('/api', healthRouter);
app.use('/api', icpRouter);
app.use('/api', companiesHouseRouter);
app.use('/api', leadsRouter);
app.use('/api', linkedinRouter);
app.use('/api', enrichmentRouter);
app.use('/api', heyreachRouter);
app.use('/api', instantlyRouter);
app.use('/api', voiceRouter);
app.use('/api', dashboardRouter);
app.use('/api', eventsRouter);
app.use('/api', notificationsRouter);
app.use('/api', meetingsRouter);
app.use('/api', integrationsRouter);
app.use('/api', reportsRouter);
app.use('/api', adminRouter);
app.use('/api', stripeRouter);
app.use('/api', onboardingRouter);

export default app;
