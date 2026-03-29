# Monthly Subscription Plan

## Overview

Add recurring subscription support for roles/products. Users pay monthly to maintain access.

## Data Model Changes

### Product Table (new fields)

```sql
ALTER TABLE products ADD COLUMN billing_type TEXT DEFAULT 'one_time';
-- Values: 'one_time' | 'subscription'

ALTER TABLE products ADD COLUMN billing_period TEXT DEFAULT NULL;
-- Values: 'monthly' | 'yearly' | NULL
```

### New: Subscriptions Table

```sql
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  -- Values: 'active' | 'expired' | 'cancelled'
  
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  last_payment_id TEXT,
  
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TEXT,
  
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (last_payment_id) REFERENCES payments(payment_id)
);

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_end ON subscriptions(current_period_end);
```

## Commands

### Product Creation

```
/product create name:VIP price:5 role:@VIP billing:monthly
```

### User Commands

```
/buy VIP              # First-time subscription purchase
/renew VIP            # Renew existing subscription
/subscriptions        # View my active subscriptions
/cancel VIP           # Cancel (expires at period end)
```

### Admin Commands

```
/admin subscriptions              # List all active subscriptions
/admin expirations [days]         # List subs expiring in next N days (default: 7)
/admin sub @user                  # View specific user's subscription status
/admin extend @user VIP 30        # Extend subscription by 30 days
/admin expire-check               # Manually run expiration check now
```

## Flows

### Initial Purchase

```
User: /buy VIP Monthly
  ↓
Show payment (same as one-time)
  ↓
Payment confirmed
  ↓
Create Subscription:
  - status: active
  - current_period_start: now
  - current_period_end: now + 30 days
  ↓
Assign Role
  ↓
DM: "Welcome to VIP! Expires: <date>"
```

### Renewal

```
User: /renew VIP
  ↓
Check active/expired subscription exists
  ↓
Show payment
  ↓
Payment confirmed
  ↓
Update Subscription:
  - current_period_end += 30 days
  - status: active (in case was expired)
  ↓
Ensure Role assigned
  ↓
DM: "Renewed! New expiration: <date>"
```

### Expiration Check (Daily Cron)

```
Every day at 00:00 UTC:
  ↓
Find subscriptions where:
  - status = 'active'
  - current_period_end < now
  ↓
For each:
  - Remove Role from user
  - Update status: 'expired'
  - DM: "Your VIP has expired. /renew to continue."
```

### Reminder Notifications (Daily Cron)

```
Every day at 00:00 UTC:
  ↓
Find subscriptions where:
  - status = 'active'
  - current_period_end between now and now + 3 days
  - reminder_sent = false
  ↓
For each:
  - DM: "Your VIP expires in X days. /renew to continue."
  - Mark reminder_sent = true
```

### Cancellation

```
User: /cancel VIP
  ↓
Find active subscription
  ↓
Update:
  - status: 'cancelled'
  - cancelled_at: now
  ↓
DM: "Cancelled. You'll keep access until <end_date>."
  ↓
(Role removed by expiration cron, not immediately)
```

## Key Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Auto-renewal? | No | Can't auto-debit on-chain without pre-approval |
| Grace period? | 3 days | Give time to renew, no immediate role loss |
| Early renewal? | Time stacks | User doesn't lose remaining days |
| Proration? | No | Keep simple, full month only |

## UI Changes

### Product List (shows billing type)

```
🛍️ Available Products

1. VIP Monthly - $5.00/month USDC
   Type: role | Chains: BASE/POLYGON
   
2. Lifetime Access - $50.00 USDC (one-time)
   Type: role | Chains: BASE/POLYGON
```

### Subscription Status

```
/subscriptions

📋 Your Subscriptions

✅ VIP Monthly
   Status: Active
   Expires: March 30, 2026 (in 28 days)
   [Renew Now] [Cancel]

❌ Premium (expired)
   Expired: March 1, 2026
   [Resubscribe]
```

## Implementation Order

1. Database schema changes
2. `/product create` with billing options
3. Subscription creation on purchase
4. `/subscriptions` command (user)
5. `/renew` command
6. Expiration logic (shared function)
7. Cron job for expiration + reminders
8. `/cancel` command
9. Admin commands:
   - `/admin subscriptions` - list all active
   - `/admin expirations` - list expiring soon
   - `/admin sub @user` - view user's subs
   - `/admin extend` - extend subscription
   - `/admin expire-check` - manual expiration run

## Admin Command Details

### `/admin subscriptions`
List all active subscriptions in the server.
```
📋 Active Subscriptions (12 total)

@alice - VIP Monthly (expires Mar 30)
@bob - VIP Monthly (expires Apr 5)
@charlie - Premium Yearly (expires Dec 31)
...
```

### `/admin expirations [days]`
List subscriptions expiring within N days (default: 7).
```
⏰ Expiring Soon (next 7 days)

@alice - VIP Monthly - expires in 2 days
@dave - Premium - expires in 5 days

Total: 2 subscriptions expiring
```

### `/admin sub @user`
View detailed subscription info for a specific user.
```
👤 @alice's Subscriptions

✅ VIP Monthly
   Status: Active
   Started: Feb 28, 2026
   Expires: Mar 30, 2026 (in 2 days)
   Payments: 3 ($15.00 total)

❌ Premium (expired)
   Expired: Jan 15, 2026
```

### `/admin expire-check`
Manually trigger expiration check. Useful for testing or immediate cleanup.
```
🔄 Running expiration check...

Expired: 2 subscriptions
- @eve VIP Monthly (role removed)
- @frank Premium (role removed)

Reminders sent: 3 users
```

## Dependencies

- Cron/scheduler (node-cron or external)
- Timezone handling for expiration checks
