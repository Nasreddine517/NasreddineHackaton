CREATE TABLE followup_assignments (
  customer_id text PRIMARY KEY REFERENCES customers(id),
  variant text NOT NULL CHECK (variant IN ('A','B')),
  experiment text NOT NULL DEFAULT 'abandon-v1',
  assigned_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE followups (
  id uuid PRIMARY KEY,
  customer_id text NOT NULL REFERENCES conversations(customer_id),
  last_message_id bigint NOT NULL REFERENCES chat_messages(id),
  due_at timestamptz NOT NULL,
  variant text NOT NULL CHECK (variant IN ('A','B')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','cancelled','failed')),
  reason text,
  sent_at timestamptz,
  response_at timestamptz,
  order_id text REFERENCES orders(id),
  message_id bigint UNIQUE REFERENCES chat_messages(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id,last_message_id)
);
CREATE INDEX followups_pending_idx ON followups(due_at) WHERE status='pending';
CREATE INDEX followups_customer_idx ON followups(customer_id,created_at DESC);

-- Invalidation and attribution occur in the same transaction as the triggering
-- business event. Returning control to Kenza never revives a cancelled reminder.
CREATE FUNCTION invalidate_followups() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mode='human' OR NEW.followup_refused OR
     NEW.last_client_message_at IS DISTINCT FROM OLD.last_client_message_at THEN
    UPDATE followups SET status='cancelled',reason=CASE
      WHEN NEW.mode='human' THEN 'human' WHEN NEW.followup_refused THEN 'refused'
      ELSE 'new_message' END WHERE customer_id=NEW.customer_id AND status='pending';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER conversations_invalidate_followups AFTER UPDATE ON conversations
FOR EACH ROW EXECUTE FUNCTION invalidate_followups();

CREATE FUNCTION followup_response() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role='user' THEN
    UPDATE followups SET response_at=NEW.created_at WHERE id=(
      SELECT id FROM followups WHERE customer_id=NEW.customer_id AND status='sent'
      AND sent_at<=NEW.created_at AND sent_at>NEW.created_at-interval '24 hours'
      ORDER BY sent_at DESC LIMIT 1
    ) AND response_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER chat_followup_response AFTER INSERT ON chat_messages
FOR EACH ROW EXECUTE FUNCTION followup_response();

CREATE FUNCTION followup_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source='kenza' AND NEW.status='confirmed' THEN
    UPDATE followups SET status='cancelled',reason='ordered'
      WHERE customer_id=NEW.customer_id AND status='pending';
    UPDATE followups SET order_id=NEW.id WHERE id=(
      SELECT id FROM followups WHERE customer_id=NEW.customer_id AND status='sent'
      AND sent_at<=NEW.created_at AND sent_at>NEW.created_at-interval '24 hours'
      ORDER BY sent_at DESC LIMIT 1
    ) AND order_id IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_followup AFTER INSERT ON orders
FOR EACH ROW EXECUTE FUNCTION followup_order();
