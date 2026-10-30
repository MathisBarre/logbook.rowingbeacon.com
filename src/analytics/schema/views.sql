-- Analytics views (ADR 0008). TEMP views created on each analytics
-- connection by the read-only engine, never stored in main.db.
-- One block per view, introduced by
--   -- @view <name> requires=<table>[,<table>]
-- and made of one CREATE TEMP VIEW statement. A block whose tables are
-- missing is skipped. Order matters: later views use earlier ones.
-- Before execution {{SEASON_START_MONTH}} is replaced by the setting
-- analytics.seasonStartMonth (integer 1-12, default 8) and {{NOW}} by the
-- local wall-clock time of the request, "YYYY-MM-DDTHH:mm". Both are
-- validated first, so the substitution cannot inject SQL.
-- Stored dates are local wall-clock text "YYYY-MM-DDTHH:mm": never apply
-- the 'utc' or 'localtime' modifiers to them.

-- @view v_settings requires=
CREATE TEMP VIEW v_settings AS
SELECT
  {{SEASON_START_MONTH}} AS season_start_month,
  '{{NOW}}' AS now,
  substr('{{NOW}}', 1, 10) AS today,
  CAST(substr('{{NOW}}', 1, 4) AS INTEGER)
    - (CAST(substr('{{NOW}}', 6, 2) AS INTEGER) < {{SEASON_START_MONTH}}) AS current_season;

-- @view v_boats requires=boat,boat_configuration
CREATE TEMP VIEW v_boats AS
SELECT
  b.id AS boat_id,
  b.name AS boat_name,
  c.seats AS seats,
  c.rigging AS rigging,
  COALESCE(c.coxed, 0) AS coxed,
  CASE WHEN c.seats IS NULL THEN NULL ELSE
    c.seats
    || CASE WHEN c.rigging = 'scull' THEN 'x'
            WHEN c.rigging = 'sweep' AND c.coxed = 0 THEN '-' ELSE '' END
    || CASE WHEN c.coxed = 1 THEN '+' ELSE '' END
  END AS boat_class,
  CASE WHEN c.seats IS NULL THEN NULL ELSE c.seats + COALESCE(c.coxed, 0) END AS crew_capacity,
  b.is_in_maintenance AS is_in_maintenance,
  b.exclude_from_stats AS exclude_from_stats,
  (b.archived_at IS NOT NULL) AS is_archived,
  b.build_year AS build_year,
  b.purchase_date AS purchase_date,
  b.manufacturer AS manufacturer,
  b.model AS model,
  b.owner AS owner
FROM main.boat b
LEFT JOIN main.boat_configuration c ON c.id = (
  SELECT c2.id FROM main.boat_configuration c2
  WHERE c2.boat_id = b.id
  ORDER BY (c2.archived_at IS NOT NULL), c2.is_default DESC, c2.position
  LIMIT 1)
WHERE b.merged_into_id IS NULL;

-- @view v_rowers requires=rower,outing_crew,outing
CREATE TEMP VIEW v_rowers AS
SELECT
  r.id AS rower_id,
  'R-' || upper(substr(replace(r.id, '-', ''), 1, 8)) AS rower_code,
  TRIM(r.first_name || ' ' || r.last_name) AS display_name,
  r.status AS rower_status,
  r.gender AS gender,
  r.age_category AS age_category,
  r.seriousness AS seriousness,
  CAST(substr(r.birth_date, 1, 4) AS INTEGER) AS birth_year,
  r.exclude_from_stats AS exclude_from_stats,
  (r.archived_at IS NOT NULL) AS is_archived,
  (r.anonymized_at IS NOT NULL) AS is_anonymized,
  (SELECT MIN(o.start_date_time) FROM main.outing_crew oc
     JOIN main.outing o ON o.id = oc.outing_id WHERE oc.rower_id = r.id) AS first_outing_at,
  (SELECT MAX(o.start_date_time) FROM main.outing_crew oc
     JOIN main.outing o ON o.id = oc.outing_id WHERE oc.rower_id = r.id) AS last_outing_at,
  (SELECT COUNT(*) FROM main.outing_crew oc WHERE oc.rower_id = r.id) AS outing_count
FROM main.rower r
WHERE r.merged_into_id IS NULL;

-- @view v_routes requires=route
CREATE TEMP VIEW v_routes AS
SELECT
  rt.id AS route_id,
  rt.name AS route_name,
  NULLIF(rt.distance_m, 0) AS distance_m,
  NULLIF(rt.distance_m, 0) / 1000.0 AS distance_km,
  (rt.archived_at IS NOT NULL) AS is_archived
FROM main.route rt
WHERE rt.merged_into_id IS NULL;

-- @view v_outing_types requires=outing_type
CREATE TEMP VIEW v_outing_types AS
SELECT code AS outing_type_code, label AS custom_label, is_builtin, position,
  (archived_at IS NOT NULL) AS is_archived
FROM main.outing_type;

-- @view v_outings requires=outing,outing_crew,boat,boat_configuration,route
CREATE TEMP VIEW v_outings AS
SELECT
  o.id AS outing_id,
  o.boat_id AS boat_id,
  b.name AS boat_name,
  CASE WHEN c.seats IS NULL THEN NULL ELSE
    c.seats
    || CASE WHEN c.rigging = 'scull' THEN 'x'
            WHEN c.rigging = 'sweep' AND c.coxed = 0 THEN '-' ELSE '' END
    || CASE WHEN c.coxed = 1 THEN '+' ELSE '' END
  END AS boat_class,
  c.seats AS seats,
  c.rigging AS rigging,
  COALESCE(c.coxed, 0) AS coxed,
  o.route_id AS route_id,
  rt.name AS route_name,
  COALESCE(o.outing_type_code, 'normal') AS outing_type_code,
  o.start_date_time AS start_at,
  o.end_date_time AS end_at,
  o.estimated_end_date_time AS estimated_end_at,
  substr(o.start_date_time, 1, 10) AS start_date,
  substr(o.start_date_time, 1, 7) AS start_month_key,
  CAST(substr(o.start_date_time, 1, 4) AS INTEGER) AS start_year,
  CAST(substr(o.start_date_time, 6, 2) AS INTEGER) AS start_month,
  ((CAST(strftime('%w', o.start_date_time) AS INTEGER) + 6) % 7) + 1 AS start_weekday,
  CAST(substr(o.start_date_time, 12, 2) AS INTEGER) AS start_hour,
  date(o.start_date_time,
       '-' || ((CAST(strftime('%w', o.start_date_time) AS INTEGER) + 6) % 7) || ' days') AS start_week,
  CAST(substr(o.start_date_time, 1, 4) AS INTEGER)
    - (CAST(substr(o.start_date_time, 6, 2) AS INTEGER) < {{SEASON_START_MONTH}}) AS season,
  CAST((unixepoch(substr(o.start_date_time, 1, 10)) - unixepoch(printf('%04d-%02d-01',
      CAST(substr(o.start_date_time, 1, 4) AS INTEGER)
        - (CAST(substr(o.start_date_time, 6, 2) AS INTEGER) < {{SEASON_START_MONTH}}),
      {{SEASON_START_MONTH}}))) / 604800 AS INTEGER) + 1 AS season_week,
  (o.end_date_time IS NULL) AS is_ongoing,
  (o.end_date_time IS NOT NULL
     AND substr(o.end_date_time, 1, 10) <> substr(o.start_date_time, 1, 10)) AS is_multi_day,
  CASE WHEN o.end_date_time IS NULL OR o.end_date_time < o.start_date_time THEN NULL
       ELSE (unixepoch(o.end_date_time) - unixepoch(o.start_date_time)) / 60 END AS duration_min,
  (substr(o.start_date_time, 12, 5) <> '00:00') AS has_start_time,
  (COALESCE(o.outing_type_code, 'normal') <> 'motorboat') AS is_rowing,
  COALESCE(NULLIF(o.distance_m, 0), NULLIF(rt.distance_m, 0)) AS distance_m,
  COALESCE(NULLIF(o.distance_m, 0), NULLIF(rt.distance_m, 0)) / 1000.0 AS distance_km,
  CASE WHEN NULLIF(o.distance_m, 0) IS NOT NULL THEN 'recorded'
       WHEN NULLIF(rt.distance_m, 0) IS NOT NULL THEN 'route' END AS distance_source,
  o.has_been_coached AS is_coached,
  o.captain_rower_id AS captain_rower_id,
  o.comment AS comment,
  (SELECT COUNT(*) FROM main.outing_crew oc WHERE oc.outing_id = o.id) AS crew_size,
  (SELECT COUNT(*) FROM main.outing_crew oc
     WHERE oc.outing_id = o.id AND oc.role = 'rower') AS rower_count,
  (SELECT COUNT(*) FROM main.outing_crew oc
     WHERE oc.outing_id = o.id AND oc.role = 'cox') AS cox_count,
  CASE WHEN o.end_date_time IS NOT NULL AND o.estimated_end_date_time IS NOT NULL
       THEN (unixepoch(o.end_date_time) - unixepoch(o.estimated_end_date_time)) / 60 END AS return_delay_min,
  (COALESCE(b.exclude_from_stats, 0) = 0) AS counts_in_stats
FROM main.outing o
LEFT JOIN main.boat b ON b.id = o.boat_id
LEFT JOIN main.route rt ON rt.id = o.route_id
LEFT JOIN main.boat_configuration c ON c.id = COALESCE(o.boat_configuration_id, (
  SELECT c2.id FROM main.boat_configuration c2
  WHERE c2.boat_id = o.boat_id
  ORDER BY (c2.archived_at IS NOT NULL), c2.is_default DESC, c2.position
  LIMIT 1));

-- @view v_outing_rowers requires=outing,outing_crew,rower,boat,boat_configuration,route
CREATE TEMP VIEW v_outing_rowers AS
SELECT
  o.outing_id, o.boat_id, o.boat_name, o.boat_class, o.route_id, o.route_name,
  o.outing_type_code, o.start_at, o.end_at, o.start_date, o.start_month_key,
  o.start_year, o.start_month, o.start_weekday, o.start_hour, o.start_week,
  o.season, o.season_week, o.is_ongoing, o.is_multi_day, o.duration_min,
  o.has_start_time, o.is_rowing, o.distance_m, o.distance_km, o.is_coached,
  oc.rower_id AS rower_id,
  'R-' || upper(substr(replace(r.id, '-', ''), 1, 8)) AS rower_code,
  TRIM(r.first_name || ' ' || r.last_name) AS display_name,
  r.status AS rower_status,
  r.gender AS gender,
  r.age_category AS age_category,
  r.seriousness AS seriousness,
  o.start_year - CAST(substr(r.birth_date, 1, 4) AS INTEGER) AS age_in_year,
  oc.role AS role,
  oc.position AS seat_position,
  (o.captain_rower_id IS NOT NULL AND o.captain_rower_id = oc.rower_id) AS is_captain,
  (o.counts_in_stats AND COALESCE(r.exclude_from_stats, 0) = 0) AS counts_in_stats
FROM main.outing_crew oc
JOIN v_outings o ON o.outing_id = oc.outing_id
JOIN main.rower r ON r.id = oc.rower_id;

-- @view v_seasons requires=outing
CREATE TEMP VIEW v_seasons AS
WITH RECURSIVE s(season) AS (
  SELECT MIN(
    COALESCE((SELECT MIN(CAST(substr(start_date_time, 1, 4) AS INTEGER)
                - (CAST(substr(start_date_time, 6, 2) AS INTEGER) < {{SEASON_START_MONTH}}))
              FROM main.outing), (SELECT current_season FROM v_settings)),
    (SELECT current_season FROM v_settings))
  UNION ALL
  SELECT season + 1 FROM s WHERE season < (SELECT current_season FROM v_settings)
)
SELECT
  s.season AS season,
  printf('%04d-%02d-01', s.season, st.season_start_month) AS start_date,
  printf('%04d-%02d-01', s.season + 1, st.season_start_month) AS end_date,
  MIN(printf('%04d-%02d-01', s.season + 1, st.season_start_month), date(st.today, '+1 day')) AS cutoff_date,
  (s.season = st.current_season) AS is_current
FROM s, v_settings st;

-- @view v_days requires=outing
CREATE TEMP VIEW v_days AS
WITH RECURSIVE d(day) AS (
  SELECT MIN(COALESCE((SELECT substr(MIN(start_date_time), 1, 10) FROM main.outing),
                      (SELECT today FROM v_settings)),
             (SELECT today FROM v_settings))
  UNION ALL
  SELECT date(day, '+1 day') FROM d WHERE day < (SELECT today FROM v_settings)
)
SELECT
  d.day AS day,
  CAST(substr(d.day, 1, 4) AS INTEGER) AS year,
  CAST(substr(d.day, 6, 2) AS INTEGER) AS month,
  ((CAST(strftime('%w', d.day) AS INTEGER) + 6) % 7) + 1 AS weekday,
  CAST(substr(d.day, 1, 4) AS INTEGER)
    - (CAST(substr(d.day, 6, 2) AS INTEGER) < st.season_start_month) AS season
FROM d, v_settings st;

-- @view v_incidents requires=incident,boat
CREATE TEMP VIEW v_incidents AS
SELECT
  i.id AS incident_id,
  i.boat_id AS boat_id,
  b.name AS boat_name,
  i.outing_id AS outing_id,
  i.occurred_at AS occurred_at,
  substr(i.occurred_at, 1, 10) AS occurred_date,
  CAST(substr(i.occurred_at, 1, 4) AS INTEGER)
    - (CAST(substr(i.occurred_at, 6, 2) AS INTEGER) < {{SEASON_START_MONTH}}) AS season,
  i.message AS message
FROM main.incident i
LEFT JOIN main.boat b ON b.id = i.boat_id;

-- @view v_damages requires=boat_damage,boat
CREATE TEMP VIEW v_damages AS
SELECT
  d.id AS damage_id,
  d.boat_id AS boat_id,
  b.name AS boat_name,
  d.kind AS damage_kind,
  d.severity AS severity,
  d.reported_at AS reported_at,
  substr(d.reported_at, 1, 10) AS reported_date,
  CAST(substr(d.reported_at, 1, 4) AS INTEGER)
    - (CAST(substr(d.reported_at, 6, 2) AS INTEGER) < {{SEASON_START_MONTH}}) AS season,
  d.fixed_at AS fixed_at,
  (d.fixed_at IS NULL) AS is_open,
  CAST((COALESCE(unixepoch(d.fixed_at), (SELECT unixepoch(now) FROM v_settings))
        - unixepoch(d.reported_at)) / 86400 AS INTEGER) AS days_open,
  d.repair_cost AS repair_cost,
  d.outing_id AS outing_id,
  d.incident_id AS incident_id,
  d.description AS description
FROM main.boat_damage d
LEFT JOIN main.boat b ON b.id = d.boat_id;
