CREATE TABLE conversations (
  customer_id text PRIMARY KEY REFERENCES customers(id),
  mode text NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto','human')),
  followup_refused boolean NOT NULL DEFAULT false,
  last_client_message_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE chat_turns (
  id uuid PRIMARY KEY,
  customer_id text NOT NULL REFERENCES conversations(customer_id),
  input text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE chat_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id text NOT NULL REFERENCES conversations(customer_id),
  turn_id uuid REFERENCES chat_turns(id),
  role text NOT NULL CHECK (role IN ('user','assistant','merchant')),
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(turn_id,role)
);
CREATE INDEX chat_messages_customer_idx ON chat_messages(customer_id,id DESC);
CREATE TABLE customer_memories (
  customer_id text NOT NULL REFERENCES customers(id),
  key text NOT NULL CHECK (key IN ('color','size','style','budget','language')),
  value text NOT NULL,
  evidence text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(customer_id,key)
);
CREATE TABLE agent_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id text NOT NULL REFERENCES conversations(customer_id),
  turn_id uuid REFERENCES chat_turns(id),
  agent text NOT NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_events_customer_idx ON agent_events(customer_id,id DESC);
CREATE TABLE escalations (
  id uuid PRIMARY KEY,
  customer_id text NOT NULL REFERENCES conversations(customer_id),
  turn_id uuid NOT NULL UNIQUE REFERENCES chat_turns(id),
  reason text NOT NULL,
  context jsonb NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);
