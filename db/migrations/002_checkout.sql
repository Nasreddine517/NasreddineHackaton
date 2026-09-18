CREATE TABLE carts (
  customer_id text PRIMARY KEY REFERENCES customers(id),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cart_items (
  customer_id text NOT NULL REFERENCES carts(customer_id),
  product_ref text NOT NULL REFERENCES products(ref),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  PRIMARY KEY (customer_id, product_ref)
);
CREATE TABLE checkout_quotes (
  id uuid PRIMARY KEY,
  customer_id text NOT NULL REFERENCES carts(customer_id),
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  order_id text UNIQUE REFERENCES orders(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checkout_quotes_customer_idx ON checkout_quotes(customer_id, created_at DESC);
ALTER TABLE orders ADD COLUMN fulfillment_method text;
ALTER TABLE order_lines ADD COLUMN price_source text;
