-- Esquema según el modelo de datos del proyecto.
-- Todas las fechas se guardan en UTC.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS servers (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  hostname  VARCHAR(100) NOT NULL,
  ip        VARCHAR(45)  NOT NULL,
  comunidad VARCHAR(64)  NOT NULL DEFAULT 'public',
  enabled   TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY uq_servers_ip (ip),
  UNIQUE KEY uq_servers_hostname (hostname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS metrics (
  id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  server_id INT      NOT NULL,
  fecha     DATETIME NOT NULL,
  cpu       DECIMAL(5,2),
  ram       DECIMAL(5,2),
  disco     DECIMAL(5,2),
  uptime    BIGINT,
  KEY idx_metrics_server_fecha (server_id, fecha),
  CONSTRAINT fk_metrics_server FOREIGN KEY (server_id)
    REFERENCES servers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  clave VARCHAR(64)  PRIMARY KEY,
  valor VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO settings (clave, valor) VALUES
  ('intervalo_minutos', '5'),
  ('umbral_aviso', '70'),
  ('umbral_critico', '90'),
  ('comunidad_default', 'public'),
  ('retencion_dias', '30')
ON DUPLICATE KEY UPDATE valor = valor;

-- Limpieza automática del histórico según settings.retencion_dias.
-- (el event scheduler viene activado por defecto en MySQL 8)
CREATE EVENT IF NOT EXISTS purge_old_metrics
  ON SCHEDULE EVERY 1 DAY
  DO
    DELETE m FROM metrics m
    JOIN settings s ON s.clave = 'retencion_dias'
    WHERE m.fecha < UTC_TIMESTAMP() - INTERVAL CAST(s.valor AS UNSIGNED) DAY;
