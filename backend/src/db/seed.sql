-- Seed data for the email sequencer
-- Passwords are bcrypt hashes of 'password123'

-- Users
INSERT INTO users (id, email, password_hash) VALUES
(1, 'alice@test.com', '$2b$10$U6u3oA5v2OCVEpCB3/W5guEThSG3NkbpmbuZJPRlwx3RqfFAvRGnW'),
(2, 'bob@test.com',   '$2b$10$U6u3oA5v2OCVEpCB3/W5guEThSG3NkbpmbuZJPRlwx3RqfFAvRGnW');

-- Mailboxes: Alice has 3, Bob has 1
INSERT INTO mailboxes (id, user_id, email, daily_limit, hourly_limit) VALUES
(1, 1, 'alice-work@example.com',   100, 20),
(2, 1, 'alice-sales@example.com',  50,  10),
(3, 1, 'alice-outreach@example.com', 200, 30),
(4, 2, 'bob-work@example.com',     100, 15);

-- Sequences: Alice has 2, Bob has none
INSERT INTO sequences (id, user_id, name, status) VALUES
(1, 1, 'Welcome Drip Campaign',   'active'),
(2, 1, 'Follow-up Nurture Series', 'draft');

-- Sequence Steps
-- Sequence 1: 3 steps
INSERT INTO sequence_steps (id, sequence_id, step_order, delay_days, subject, body) VALUES
(1, 1, 1, 0, 'Welcome aboard!',           'Hi {{name}}, thanks for signing up!'),
(2, 1, 2, 2, 'Quick tips to get started',  'Here are some tips to help you get the most out of our product...'),
(3, 1, 3, 5, 'How are things going?',      'Just checking in — is there anything we can help with?');

-- Sequence 2: 2 steps
INSERT INTO sequence_steps (id, sequence_id, step_order, delay_days, subject, body) VALUES
(4, 2, 1, 0, 'Following up on our chat',  'Hi {{name}}, great speaking with you...'),
(5, 2, 2, 3, 'Any questions?',            'Just wanted to see if you had any questions...');

-- Prospects for Sequence 1
INSERT INTO prospects (id, sequence_id, email, name, status) VALUES
(1, 1, 'lead1@prospect.com', 'Jordan Smith',   'active'),
(2, 1, 'lead2@prospect.com', 'Casey Johnson',  'active'),
(3, 1, 'lead3@prospect.com', 'Morgan Lee',     'active'),
(4, 1, 'lead4@prospect.com', 'Taylor Brown',   'unsubscribed');

-- Prospects for Sequence 2
INSERT INTO prospects (id, sequence_id, email, name, status) VALUES
(5, 2, 'lead5@prospect.com', 'Alex Williams', 'active'),
(6, 2, 'lead6@prospect.com', 'Sam Davis',     'active');

-- Pre-scheduled emails for Sequence 1 (active) — scheduled at NOW() so worker picks them up
INSERT INTO scheduled_emails (id, sequence_id, step_id, prospect_id, mailbox_id, scheduled_at, status, attempts) VALUES
-- Step 1 (delay_days=0) for active prospects → scheduled now
(1,  1, 1, 1, 1, NOW(), 'pending', 0),
(2,  1, 1, 2, 1, NOW(), 'pending', 0),
(3,  1, 1, 3, 1, NOW(), 'pending', 0),
-- Step 2 (delay_days=2) for active prospects → scheduled +2 days
(4,  1, 2, 1, 1, DATE_ADD(NOW(), INTERVAL 2 DAY), 'pending', 0),
(5,  1, 2, 2, 1, DATE_ADD(NOW(), INTERVAL 2 DAY), 'pending', 0),
(6,  1, 2, 3, 1, DATE_ADD(NOW(), INTERVAL 2 DAY), 'pending', 0),
-- Step 3 (delay_days=5) for active prospects → scheduled +5 days
(7,  1, 3, 1, 1, DATE_ADD(NOW(), INTERVAL 5 DAY), 'pending', 0),
(8,  1, 3, 2, 1, DATE_ADD(NOW(), INTERVAL 5 DAY), 'pending', 0),
(9,  1, 3, 3, 1, DATE_ADD(NOW(), INTERVAL 5 DAY), 'pending', 0);
