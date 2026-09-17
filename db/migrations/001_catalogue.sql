CREATE TABLE seed_runs (
  name text PRIMARY KEY,
  checksum text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  ref text PRIMARY KEY,
  model text NOT NULL,
  family text NOT NULL,
  gender text NOT NULL,
  color text NOT NULL,
  size text NOT NULL,
  material text NOT NULL,
  season text NOT NULL,
  price_centimes integer NOT NULL CHECK (price_centimes >= 0),
  stock integer NOT NULL CHECK (stock >= 0),
  restock_days_internal integer CHECK (restock_days_internal >= 0),
  barcode text NOT NULL,
  weight_g integer NOT NULL CHECK (weight_g >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id text PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL,
  city text NOT NULL,
  preferred_language text NOT NULL,
  first_purchase date,
  historical_order_count integer NOT NULL DEFAULT 0 CHECK (historical_order_count >= 0),
  segment text NOT NULL,
  source text NOT NULL CHECK (source IN ('historical', 'demo')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE delivery_zones (
  city text PRIMARY KEY,
  fee_centimes integer NOT NULL CHECK (fee_centimes >= 0),
  delay_hours integer NOT NULL CHECK (delay_hours > 0),
  cash_on_delivery boolean NOT NULL,
  pickup boolean NOT NULL
);

CREATE TABLE promotions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_ref text NOT NULL REFERENCES products(ref),
  price_centimes integer NOT NULL CHECK (price_centimes >= 0),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  condition text NOT NULL,
  UNIQUE (product_ref, starts_on, ends_on),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE orders (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  created_at timestamptz NOT NULL,
  channel text NOT NULL,
  status text NOT NULL,
  subtotal_centimes integer NOT NULL CHECK (subtotal_centimes >= 0),
  delivery_centimes integer NOT NULL CHECK (delivery_centimes >= 0),
  total_centimes integer NOT NULL CHECK (total_centimes = subtotal_centimes + delivery_centimes),
  delivery_city text NOT NULL,
  delivery_address text,
  payment_method text NOT NULL,
  source text NOT NULL CHECK (source IN ('historical', 'kenza')),
  idempotency_key text UNIQUE
);
CREATE INDEX orders_customer_created_idx ON orders (customer_id, created_at DESC);

CREATE TABLE order_lines (
  order_id text NOT NULL REFERENCES orders(id),
  line_number integer NOT NULL,
  product_ref text NOT NULL REFERENCES products(ref),
  model text NOT NULL,
  size text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_centimes integer NOT NULL CHECK (unit_price_centimes >= 0),
  PRIMARY KEY (order_id, line_number)
);

-- Examples are reference material, not live conversations or current price truth.
CREATE TABLE conversation_examples (
  id text PRIMARY KEY,
  payload jsonb NOT NULL
);
