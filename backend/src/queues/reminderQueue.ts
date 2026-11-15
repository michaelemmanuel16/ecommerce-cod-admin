import Bull from 'bull';
import logger from '../utils/logger';
import { processDueReminders } from '../services/reminderService';

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
};

export const reminderQueue = process.env.NODE_ENV === 'test'
    ? ({
        process: () => { },
        on: () => { },
        add: () => { },
        close: () => Promise.resolve(),
    } as any)
    : new Bull('reminders-due', {
        redis: redisConfig,
        defaultJobOptions: { removeOnComplete: true, removeOnFail: 50 },
    });

// M9-T18: every minute, send the reminders that are due. The job reads the database: a restart loses nothing.
export const REMINDER_DUE_JOB = 'send-due-reminders';
export const processReminderJob = async () => {
    const sent = await processDueReminders();
    if (sent > 0) logger.info(`Reminders sent: ${sent}`);
    return sent;
};
reminderQueue.process(REMINDER_DUE_JOB, processReminderJob);

export const setupReminderCron = async () => {
    if (process.env.NODE_ENV === 'test') return;

    // Remove existing repeatable jobs to avoid duplicates on restart
    const repeatableJobs = await reminderQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        await reminderQueue.removeRepeatableByKey(job.key);
    }

    await reminderQueue.add(REMINDER_DUE_JOB, {}, { repeat: { cron: '* * * * *' } });
    logger.info('Reminder due job scheduled (every minute).');
};

reminderQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    logger.error(`Reminder job ${job?.id} failed:`, err);
});

export default reminderQueue;
