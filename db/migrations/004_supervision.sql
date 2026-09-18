-- A retried merchant reply must never be sent twice, even after an API restart.
ALTER TABLE chat_messages ADD COLUMN merchant_request_id uuid UNIQUE;
