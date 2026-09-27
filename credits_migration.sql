CREATE TABLE IF NOT EXISTS credit_balances (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  free_credits integer NOT NULL DEFAULT 30 CHECK (free_credits >= 0),
  paid_credits integer NOT NULL DEFAULT 0 CHECK (paid_credits >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO credit_balances (user_id, free_credits, paid_credits)
SELECT id, 30, 0
FROM users
ON CONFLICT (user_id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE
ON TABLE credit_balances
TO metrictree_app;
