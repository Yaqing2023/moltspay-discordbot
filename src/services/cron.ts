/**
 * Cron Service - Scheduled tasks
 */

import { Client } from 'discord.js';
import { processExpiredSubscriptions } from './subscription';

let cronInterval: NodeJS.Timeout | null = null;

/**
 * Start the cron service
 * Runs expiration check daily at midnight UTC
 */
export function startCron(client: Client): void {
  if (cronInterval) {
    console.log('[Cron] Already running');
    return;
  }
  
  // Calculate time until next midnight UTC
  const now = new Date();
  const nextMidnight = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  const msUntilMidnight = nextMidnight.getTime() - now.getTime();
  
  console.log(`[Cron] Will run first check at ${nextMidnight.toISOString()}`);
  
  // Schedule first run at midnight
  setTimeout(() => {
    runDailyCheck(client);
    
    // Then run every 24 hours
    cronInterval = setInterval(() => {
      runDailyCheck(client);
    }, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
  
  // Also run a check shortly after startup (5 minutes) to catch anything missed
  setTimeout(() => {
    console.log('[Cron] Running startup check...');
    runDailyCheck(client);
  }, 5 * 60 * 1000);
  
  console.log('[Cron] Scheduler started');
}

/**
 * Stop the cron service
 */
export function stopCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
    console.log('[Cron] Scheduler stopped');
  }
}

/**
 * Run the daily subscription check
 */
async function runDailyCheck(client: Client): Promise<void> {
  console.log('[Cron] Running daily subscription check...');
  
  try {
    const results = await processExpiredSubscriptions(client);
    
    const expiredCount = results.expired.length;
    const reminderCount = results.reminders.filter(r => r.sent).length;
    
    console.log(`[Cron] Check complete: ${expiredCount} expired, ${reminderCount} reminders sent`);
    
    // Log any errors
    for (const { subscription, error } of results.expired.filter(r => r.error)) {
      console.error(`[Cron] Expiration error for ${subscription.userId}:`, error);
    }
    for (const { subscription, error } of results.reminders.filter(r => r.error)) {
      console.warn(`[Cron] Reminder issue for ${subscription.userId}:`, error);
    }
  } catch (error) {
    console.error('[Cron] Daily check failed:', error);
  }
}

/**
 * Manually trigger the daily check (for testing/admin use)
 */
export async function runManualCheck(client: Client) {
  return runDailyCheck(client);
}
