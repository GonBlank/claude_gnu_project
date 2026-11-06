-- Datos de prueba OPCIONALES: dos servidores y 24 h de mediciones inventadas.
-- Borrá este archivo cuando el worker real empiece a escribir en la base.
INSERT INTO servers (hostname, ip, comunidad, enabled) VALUES
  ('ubuntu-01', '192.168.56.11', 'public', 1),
  ('ubuntu-02', '192.168.56.12', 'public', 1);

INSERT INTO metrics (server_id, fecha, cpu, ram, disco, uptime)
WITH RECURSIVE n (i) AS (
  SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 287
)
SELECT s.id,
       TIMESTAMP(DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:00')) - INTERVAL (n.i * 5) MINUTE,
       ROUND(25 + 20 * (0.5 + 0.5 * SIN(n.i / 20 + s.id)) + RAND() * 8, 2),
       ROUND(50 + 8 * (0.5 + 0.5 * SIN(n.i / 40 + s.id)) + RAND() * 2, 2),
       ROUND(40 + s.id * 6 + RAND() * 0.3, 2),
       1036800 + (287 - n.i) * 300
FROM servers s CROSS JOIN n;
