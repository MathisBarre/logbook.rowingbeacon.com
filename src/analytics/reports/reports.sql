-- Prebuilt reports (ADR 0008, plan appendix C). One block per report,
-- introduced by
--   -- @report <id>
-- and made of one SELECT (or WITH) statement ending with ";". Metadata
-- (category, parameters, chart…) is in catalog.json, in the same order;
-- titles and descriptions in the reports namespace of src/analytics/i18n.
-- Report ids are stable API: never rename one. Rust embeds this file for
-- the MCP tools (assets.rs).
--
-- Conventions: `b` is the season-bounds CTE (first day, first day of the
-- next season, and cutoff = min(end, tomorrow) for "same period last
-- season" comparisons). `light` reports scan one season, `heavy` ones the
-- whole history. Hours always exclude multi-day outings; rower reports
-- exclude motorboat outings (is_rowing = 0) and use counts_in_stats.

-- @report season-overview
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings),
cur AS (
  SELECT COUNT(*) AS outings, ROUND(SUM(CASE WHEN o.is_multi_day = 0 AND o.duration_min > 0 THEN o.duration_min END) / 60.0, 1) AS hours, ROUND(SUM(o.distance_km), 0) AS km,
         ROUND(AVG(o.is_coached) * 100, 0) AS coached_pct
  FROM v_outings o, b
  WHERE o.start_at >= b.start_date AND o.start_at < b.cutoff_date AND o.counts_in_stats = 1),
prev AS (
  SELECT COUNT(*) AS outings, ROUND(SUM(CASE WHEN o.is_multi_day = 0 AND o.duration_min > 0 THEN o.duration_min END) / 60.0, 1) AS hours, ROUND(SUM(o.distance_km), 0) AS km,
         ROUND(AVG(o.is_coached) * 100, 0) AS coached_pct
  FROM v_outings o, b
  WHERE o.start_at >= date(b.start_date, '-1 year') AND o.start_at < date(b.cutoff_date, '-1 year')
    AND o.counts_in_stats = 1),
cur_r AS (
  SELECT COUNT(DISTINCT r.rower_id) AS active_rowers FROM v_outing_rowers r, b
  WHERE r.start_at >= b.start_date AND r.start_at < b.cutoff_date
    AND r.counts_in_stats = 1 AND r.is_rowing = 1),
prev_r AS (
  SELECT COUNT(DISTINCT r.rower_id) AS active_rowers FROM v_outing_rowers r, b
  WHERE r.start_at >= date(b.start_date, '-1 year') AND r.start_at < date(b.cutoff_date, '-1 year')
    AND r.counts_in_stats = 1 AND r.is_rowing = 1)
SELECT cur.outings, prev.outings AS outings_prev,
       cur_r.active_rowers, prev_r.active_rowers AS active_rowers_prev,
       cur.km, prev.km AS km_prev, cur.hours, prev.hours AS hours_prev,
       cur.coached_pct, prev.coached_pct AS coached_pct_prev,
       (b.cutoff_date < b.end_date) AS is_partial, b.cutoff_date
FROM cur, prev, cur_r, prev_r, b;

-- @report yoy-monthly
WITH RECURSIVE m(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM m WHERE k < 11),
b AS (
  SELECT printf('%04d-%02d-01', :season - 1, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         -- The month in progress is compared up to the same day last year.
         date(MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
                  date(today, '+1 day')), '-1 year') AS prev_cutoff
  FROM v_settings),
months AS (
  SELECT m.k + 1 AS season_month_index,
         ((st.season_start_month - 1 + m.k) % 12) + 1 AS month
  FROM m, v_settings st),
o_agg AS (
  SELECT o.season, o.start_month AS month, COUNT(*) AS outings,
         ROUND(SUM(o.distance_km), 0) AS km, ROUND(SUM(CASE WHEN o.is_multi_day = 0 AND o.duration_min > 0 THEN o.duration_min END) / 60.0, 1) AS hours
  FROM v_outings o, b
  WHERE o.start_at >= b.start_date AND o.start_at < b.end_date AND o.counts_in_stats = 1
    AND NOT (o.season = :season - 1 AND o.start_at >= b.prev_cutoff
             AND substr(o.start_at, 1, 7) = substr(date(b.prev_cutoff, '-1 day'), 1, 7))
  GROUP BY o.season, o.start_month),
r_agg AS (
  SELECT r.season, r.start_month AS month, COUNT(*) AS participations,
         COUNT(DISTINCT r.rower_id) AS active_rowers
  FROM v_outing_rowers r, b
  WHERE r.start_at >= b.start_date AND r.start_at < b.end_date
    AND r.counts_in_stats = 1 AND r.is_rowing = 1
    AND NOT (r.season = :season - 1 AND r.start_at >= b.prev_cutoff
             AND substr(r.start_at, 1, 7) = substr(date(b.prev_cutoff, '-1 day'), 1, 7))
  GROUP BY r.season, r.start_month),
v AS (
  SELECT months.season_month_index, months.month, s.season,
         CASE :metric
           WHEN 'participations' THEN (SELECT participations FROM r_agg WHERE r_agg.season = s.season AND r_agg.month = months.month)
           WHEN 'active_rowers' THEN (SELECT active_rowers FROM r_agg WHERE r_agg.season = s.season AND r_agg.month = months.month)
           WHEN 'km' THEN (SELECT km FROM o_agg WHERE o_agg.season = s.season AND o_agg.month = months.month)
           WHEN 'hours' THEN (SELECT hours FROM o_agg WHERE o_agg.season = s.season AND o_agg.month = months.month)
           ELSE (SELECT outings FROM o_agg WHERE o_agg.season = s.season AND o_agg.month = months.month) END AS value
  FROM months
  CROSS JOIN (SELECT :season AS season UNION ALL SELECT :season - 1) s)
SELECT month,
       SUM(CASE WHEN season = :season THEN value END) AS value,
       SUM(CASE WHEN season = :season - 1 THEN value END) AS value_prev
FROM v
GROUP BY season_month_index, month
ORDER BY season_month_index;

-- @report yoy-cumulative
WITH RECURSIVE weeks(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM weeks WHERE k < 53),
w AS (
  SELECT o.season, o.season_week, COUNT(*) AS n
  FROM v_outings o
  WHERE o.season IN (:season, :season - 1) AND o.counts_in_stats = 1
  GROUP BY o.season, o.season_week),
lim AS (
  SELECT printf('%04d-%02d-01', :season, st.season_start_month) AS start_date,
         CASE WHEN :season = st.current_season
              THEN (unixepoch(st.today) - unixepoch(printf('%04d-%02d-01', :season, st.season_start_month))) / 604800 + 1
              ELSE 53 END AS last_week
  FROM v_settings st)
SELECT date(lim.start_date, '+' || ((weeks.k - 1) * 7) || ' days') AS week_start,
       CASE WHEN weeks.k <= lim.last_week
            THEN SUM(COALESCE(c.n, 0)) OVER (ORDER BY weeks.k) END AS outings_cumulative,
       SUM(COALESCE(p.n, 0)) OVER (ORDER BY weeks.k) AS outings_cumulative_prev
FROM weeks
CROSS JOIN lim
LEFT JOIN w c ON c.season = :season AND c.season_week = weeks.k
LEFT JOIN w p ON p.season = :season - 1 AND p.season_week = weeks.k
ORDER BY weeks.k;

-- @report outing-types
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings)
SELECT o.outing_type_code, COUNT(*) AS outings, ROUND(SUM(o.distance_km), 0) AS km,
       ROUND(SUM(CASE WHEN o.is_multi_day = 0 AND o.duration_min > 0 THEN o.duration_min END) / 60.0, 1) AS hours
FROM v_outings o, b
WHERE o.start_at >= b.start_date AND o.start_at < b.end_date AND o.counts_in_stats = 1
GROUP BY o.outing_type_code
ORDER BY outings DESC;

-- @report routes-usage
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings)
SELECT o.route_name, COUNT(*) AS outings, ROUND(SUM(o.distance_km), 0) AS km,
       COUNT(DISTINCT o.boat_id) AS boats
FROM v_outings o, b
WHERE o.start_at >= b.start_date AND o.start_at < b.end_date AND o.counts_in_stats = 1
  AND o.route_id IS NOT NULL
GROUP BY o.route_id
ORDER BY outings DESC;

-- @report boat-usage-ranking
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings),
u AS (
  SELECT o.boat_id, COUNT(*) AS outings, COUNT(DISTINCT o.start_date) AS days_used,
         ROUND(SUM(CASE WHEN o.is_multi_day = 0 AND o.duration_min > 0 THEN o.duration_min END) / 60.0, 1) AS hours, ROUND(SUM(o.distance_km), 0) AS km
  FROM v_outings o, b
  WHERE o.start_at >= b.start_date AND o.start_at < b.end_date
  GROUP BY o.boat_id),
last AS (SELECT boat_id, MAX(start_date) AS last_outing_date FROM v_outings GROUP BY boat_id)
SELECT vb.boat_name, vb.boat_class,
       COALESCE(u.outings, 0) AS outings, COALESCE(u.days_used, 0) AS days_used,
       u.hours, u.km, last.last_outing_date,
       (unixepoch(st.today) - unixepoch(last.last_outing_date)) / 86400 AS days_since_last
FROM v_boats vb
CROSS JOIN v_settings st
LEFT JOIN u ON u.boat_id = vb.boat_id
LEFT JOIN last ON last.boat_id = vb.boat_id
WHERE vb.is_archived = 0 AND vb.exclude_from_stats = 0
  AND (:boat_class IS NULL OR vb.boat_class = :boat_class)
ORDER BY outings DESC, vb.boat_name;

-- @report underused-boats
WITH recent AS (
  SELECT o.boat_id, COUNT(*) AS outings
  FROM v_outings o, v_settings st
  WHERE o.start_at >= date(st.today, '-' || :days || ' days')
  GROUP BY o.boat_id),
last AS (SELECT boat_id, MAX(start_date) AS last_outing_date FROM v_outings GROUP BY boat_id),
per_boat AS (
  SELECT vb.boat_name, vb.boat_class, vb.build_year, COALESCE(recent.outings, 0) AS outings_period,
         last.last_outing_date,
         (unixepoch(st.today) - unixepoch(last.last_outing_date)) / 86400 AS days_since_last
  FROM v_boats vb
  CROSS JOIN v_settings st
  LEFT JOIN recent ON recent.boat_id = vb.boat_id
  LEFT JOIN last ON last.boat_id = vb.boat_id
  WHERE vb.is_archived = 0 AND vb.exclude_from_stats = 0),
ranked AS (
  SELECT per_boat.*,
         ROUND(AVG(outings_period) OVER (PARTITION BY boat_class), 1) AS class_avg_outings
  FROM per_boat)
SELECT * FROM ranked
WHERE outings_period <= :max_outings
ORDER BY outings_period, last_outing_date NULLS FIRST;

-- @report fleet-by-class
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings),
s AS (
  SELECT o.boat_class, o.outing_id, o.start_date AS day, o.start_at, o.end_at,
         o.distance_km, o.is_multi_day
  FROM v_outings o, b
  WHERE o.start_at >= b.start_date AND o.start_at < b.end_date AND o.counts_in_stats = 1
    AND o.is_rowing = 1 AND o.boat_class IS NOT NULL),
e AS (
  SELECT boat_class, day, start_at AS t, 1 AS delta FROM s WHERE end_at IS NOT NULL AND is_multi_day = 0
  UNION ALL
  SELECT boat_class, day, end_at, -1 FROM s WHERE end_at IS NOT NULL AND is_multi_day = 0),
running AS (
  SELECT boat_class, day,
         SUM(delta) OVER (PARTITION BY boat_class, day ORDER BY t, delta
                          ROWS UNBOUNDED PRECEDING) AS concurrent
  FROM e),
daily AS (SELECT boat_class, day, MAX(concurrent) AS peak FROM running GROUP BY boat_class, day),
fleet AS (
  SELECT boat_class, COUNT(*) AS fleet_size FROM v_boats
  WHERE is_archived = 0 AND exclude_from_stats = 0 AND boat_class IS NOT NULL
  GROUP BY boat_class),
usage AS (
  SELECT boat_class, COUNT(*) AS outings, ROUND(SUM(distance_km), 0) AS km
  FROM s GROUP BY boat_class)
SELECT f.boat_class, f.fleet_size,
       COALESCE(usage.outings, 0) AS outings,
       ROUND(1.0 * COALESCE(usage.outings, 0) / f.fleet_size, 1) AS outings_per_boat,
       usage.km,
       (SELECT MAX(peak) FROM daily d WHERE d.boat_class IS f.boat_class) AS max_concurrent,
       (SELECT COUNT(*) FROM daily d WHERE d.boat_class IS f.boat_class
          AND d.peak >= f.fleet_size) AS saturated_days
FROM fleet f
LEFT JOIN usage ON usage.boat_class IS f.boat_class
ORDER BY saturated_days DESC, outings_per_boat DESC, f.boat_class;

-- @report fleet-class-monthly
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings)
SELECT o.start_month_key AS month, COALESCE(o.boat_class, 'unknown') AS boat_class, COUNT(*) AS outings
FROM v_outings o, b
WHERE o.start_at >= b.start_date AND o.start_at < b.end_date AND o.counts_in_stats = 1
  AND o.is_rowing = 1
GROUP BY 1, 2
ORDER BY 1, 2;

-- @report boat-class-week-heatmap
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings)
SELECT COALESCE(o.boat_class, 'unknown') AS boat_class, o.start_week AS week_start, COUNT(*) AS outings
FROM v_outings o, b
WHERE o.start_at >= b.start_date AND o.start_at < b.end_date AND o.counts_in_stats = 1
  AND o.is_rowing = 1
GROUP BY 1, 2
ORDER BY 1, 2;

-- @report boat-month-heatmap
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings),
agg AS (
  SELECT o.boat_id, o.boat_name, o.start_month_key AS month, COUNT(*) AS outings
  FROM v_outings o, b
  WHERE o.start_at >= b.start_date AND o.start_at < b.end_date AND o.counts_in_stats = 1
    AND (:boat_class IS NULL OR o.boat_class = :boat_class)
  GROUP BY o.boat_id, o.start_month_key),
top AS (SELECT boat_id, SUM(outings) AS total FROM agg GROUP BY boat_id ORDER BY total DESC LIMIT 40)
SELECT agg.boat_name, agg.month, agg.outings
FROM agg JOIN top USING (boat_id)
ORDER BY top.total DESC, agg.boat_name, agg.month;

-- @report active-members-demographics
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings),
a AS (
  SELECT r.rower_id, MAX(r.gender) AS gender, MAX(r.age_in_year) AS age,
         MAX(r.age_category) AS age_category, SUM(r.distance_km) AS km, COUNT(*) AS outings
  FROM v_outing_rowers r, b
  WHERE r.start_at >= b.start_date AND r.start_at < b.end_date
    AND r.counts_in_stats = 1 AND r.is_rowing = 1 AND r.rower_status = 'member'
  GROUP BY r.rower_id)
SELECT CASE WHEN age IS NOT NULL THEN CASE WHEN age <= 18 THEN 'youth' ELSE 'adult' END
            WHEN age_category IN ('J10', 'J12', 'J14', 'J16', 'J18') THEN 'youth'
            WHEN age_category = 'Senior' THEN 'adult'
            ELSE 'unknown' END AS age_group,
       COALESCE(gender, 'unknown') AS gender,
       COUNT(*) AS active_rowers, SUM(outings) AS outings, ROUND(SUM(km), 0) AS km
FROM a
GROUP BY 1, 2
ORDER BY 1, 2;

-- @report workload-by-category
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings)
SELECT r.start_month_key AS month,
       CASE :dimension
         WHEN 'seriousness' THEN COALESCE(r.seriousness, 'unknown')
         WHEN 'gender' THEN COALESCE(r.gender, 'unknown')
         WHEN 'rower_status' THEN r.rower_status
         WHEN 'boat_class' THEN COALESCE(r.boat_class, 'unknown')
         WHEN 'outing_type' THEN r.outing_type_code
         ELSE COALESCE(r.age_category, 'unknown') END AS category,
       CASE :measure
         WHEN 'hours' THEN ROUND(SUM(CASE WHEN r.is_multi_day = 0 AND r.duration_min > 0 THEN r.duration_min END) / 60.0, 1)
         WHEN 'km' THEN ROUND(SUM(r.distance_km), 0)
         WHEN 'rowers' THEN COUNT(DISTINCT r.rower_id)
         ELSE COUNT(*) END AS value
FROM v_outing_rowers r, b
WHERE r.start_at >= b.start_date AND r.start_at < b.end_date
  AND r.counts_in_stats = 1 AND r.is_rowing = 1
GROUP BY 1, 2
ORDER BY 1, 2;

-- @report outings-per-rower
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings)
SELECT COALESCE(NULLIF(r.display_name, ''), r.rower_code) AS rower_label,
       r.rower_status, r.age_category,
       COUNT(*) AS outings, ROUND(SUM(r.distance_km), 1) AS km, ROUND(SUM(CASE WHEN r.is_multi_day = 0 AND r.duration_min > 0 THEN r.duration_min END) / 60.0, 1) AS hours,
       SUM(r.is_coached = 1) AS coached_outings, MAX(r.start_date) AS last_outing_date
FROM v_outing_rowers r, b
WHERE r.start_at >= b.start_date AND r.start_at < b.end_date
  AND r.counts_in_stats = 1 AND r.is_rowing = 1
  AND (:rower_status IS NULL OR r.rower_status = :rower_status)
GROUP BY r.rower_id
ORDER BY outings DESC, rower_label;

-- @report km-challenge
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings)
SELECT COALESCE(NULLIF(r.display_name, ''), r.rower_code) AS rower_label,
       ROUND(SUM(r.distance_km), 1) AS km, COUNT(*) AS outings,
       ROUND(SUM(r.distance_km) / COUNT(*), 1) AS km_per_outing
FROM v_outing_rowers r, b
WHERE r.start_at >= b.start_date AND r.start_at < b.end_date
  AND r.counts_in_stats = 1 AND r.is_rowing = 1 AND r.outing_type_code <> 'ergometer'
  AND r.distance_km IS NOT NULL
  AND (:gender IS NULL OR r.gender = :gender)
  AND (:age_category IS NULL OR r.age_category = :age_category)
GROUP BY r.rower_id
ORDER BY km DESC
LIMIT 100;

-- @report retention-cohorts
WITH act AS MATERIALIZED (
  SELECT DISTINCT rower_id, season, rower_status FROM v_outing_rowers
  WHERE counts_in_stats = 1 AND is_rowing = 1),
firsts AS (
  SELECT rower_id, MIN(season) AS cohort FROM act
  WHERE rower_status = 'member' GROUP BY rower_id),
sizes AS (SELECT cohort, COUNT(*) AS cohort_size FROM firsts GROUP BY cohort)
SELECT f.cohort, a.season - f.cohort AS seasons_after, s.cohort_size,
       COUNT(*) AS still_active,
       ROUND(100.0 * COUNT(*) / s.cohort_size, 0) AS retention_pct
FROM firsts f
JOIN act a ON a.rower_id = f.rower_id
JOIN sizes s ON s.cohort = f.cohort
GROUP BY f.cohort, a.season
ORDER BY f.cohort, seasons_after;

-- @report new-rower-survival
WITH per AS (
  SELECT rower_id, MIN(start_date) AS first_date, MAX(start_date) AS last_date
  FROM v_outing_rowers
  WHERE counts_in_stats = 1 AND is_rowing = 1 AND rower_status = 'member'
  GROUP BY rower_id),
hist AS (SELECT substr(MIN(start_date_time), 1, 10) AS history_start FROM main.outing),
pop AS (
  SELECT per.* FROM per, hist
  WHERE per.first_date >= date(hist.history_start, '+60 days')),
n(months) AS (VALUES (1), (2), (3), (6), (9), (12), (18), (24))
SELECT n.months, COUNT(*) AS new_rowers,
       SUM(pop.last_date >= date(pop.first_date, '+' || n.months || ' months')) AS still_rowing,
       ROUND(100.0 * SUM(pop.last_date >= date(pop.first_date, '+' || n.months || ' months'))
             / COUNT(*), 0) AS survival_pct
FROM n
CROSS JOIN v_settings st
JOIN pop ON date(pop.first_date, '+' || n.months || ' months') <= st.today
GROUP BY n.months
ORDER BY n.months;

-- @report rower-frequency
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings),
per AS (
  SELECT r.rower_id, COUNT(*) AS n
  FROM v_outing_rowers r, b
  WHERE r.start_at >= b.start_date AND r.start_at < b.end_date
    AND r.counts_in_stats = 1 AND r.is_rowing = 1 AND r.rower_status = 'member'
  GROUP BY r.rower_id),
buckets(bucket, outings_bucket, low, high) AS (
  VALUES (1, '1', 1, 1), (2, '2–5', 2, 5), (3, '6–10', 6, 10), (4, '11–20', 11, 20),
         (5, '21–50', 21, 50), (6, '51–100', 51, 100), (7, '101+', 101, 1000000))
SELECT buckets.outings_bucket, COUNT(per.rower_id) AS rowers
FROM buckets LEFT JOIN per ON per.n BETWEEN buckets.low AND buckets.high
GROUP BY buckets.bucket
ORDER BY buckets.bucket;

-- @report inactive-rowers
WITH d AS MATERIALIZED (
  SELECT rower_id, start_date FROM v_outing_rowers
  WHERE counts_in_stats = 1 AND is_rowing = 1 AND rower_status = 'member'),
last AS (SELECT rower_id, MAX(start_date) AS last_date FROM d GROUP BY rower_id),
reg AS (
  SELECT d.rower_id, COUNT(*) AS outings_year_before
  FROM d JOIN last l ON l.rower_id = d.rower_id
  WHERE d.start_date > date(l.last_date, '-365 days')
  GROUP BY d.rower_id)
SELECT COALESCE(NULLIF(vr.display_name, ''), vr.rower_code) AS rower_label, vr.age_category,
       l.last_date AS last_outing_date,
       (unixepoch(st.today) - unixepoch(l.last_date)) / 86400 AS days_since_last,
       reg.outings_year_before
FROM last l
JOIN reg ON reg.rower_id = l.rower_id
JOIN v_rowers vr ON vr.rower_id = l.rower_id
CROSS JOIN v_settings st
WHERE vr.is_archived = 0
  AND l.last_date <= date(st.today, '-' || :days || ' days')
  AND l.last_date > date(st.today, '-730 days')
  AND reg.outings_year_before >= :min_outings
ORDER BY reg.outings_year_before DESC, l.last_date DESC;

-- @report active-rowers-monthly
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings),
m AS MATERIALIZED (
  SELECT DISTINCT r.start_month_key AS month, r.rower_id
  FROM v_outing_rowers r, b
  WHERE r.start_at >= b.start_date AND r.start_at < b.end_date
    AND r.counts_in_stats = 1 AND r.is_rowing = 1),
earlier AS (
  SELECT mr.rower_id
  FROM (SELECT DISTINCT rower_id FROM m) mr, b
  WHERE EXISTS (
    SELECT 1 FROM main.outing_crew oc JOIN main.outing o ON o.id = oc.outing_id
    WHERE oc.rower_id = mr.rower_id AND o.start_date_time < b.start_date)),
firsts AS (
  SELECT rower_id, MIN(month) AS first_month FROM m
  WHERE rower_id NOT IN (SELECT rower_id FROM earlier)
  GROUP BY rower_id)
SELECT m.month, COUNT(*) - COUNT(f.rower_id) AS returning_rowers,
       COUNT(f.rower_id) AS new_rowers
FROM m LEFT JOIN firsts f ON f.rower_id = m.rower_id AND f.first_month = m.month
GROUP BY m.month
ORDER BY m.month;

-- @report guests
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings)
SELECT r.start_month_key AS month,
       SUM(r.rower_status = 'guest') AS guest_participations,
       COUNT(DISTINCT CASE WHEN r.rower_status = 'guest' THEN r.rower_id END) AS distinct_guests,
       ROUND(100.0 * SUM(r.rower_status = 'guest') / COUNT(*), 1) AS guest_share_pct
FROM v_outing_rowers r, b
WHERE r.start_at >= b.start_date AND r.start_at < b.end_date AND r.counts_in_stats = 1 AND r.is_rowing = 1
GROUP BY r.start_month_key
ORDER BY r.start_month_key;

-- @report attendance-heatmap
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings),
days AS (
  SELECT d.weekday, COUNT(*) AS occurrences
  FROM v_days d, b
  WHERE d.day >= b.start_date AND d.day < b.cutoff_date
  GROUP BY d.weekday),
agg AS (
  SELECT r.start_weekday AS weekday, r.start_hour AS hour,
         CASE :metric WHEN 'outings' THEN COUNT(DISTINCT r.outing_id) ELSE COUNT(*) END AS total
  FROM v_outing_rowers r, b
  WHERE r.start_at >= b.start_date AND r.start_at < b.cutoff_date
    AND r.counts_in_stats = 1 AND r.is_rowing = 1 AND r.has_start_time = 1
  GROUP BY r.start_weekday, r.start_hour)
SELECT agg.weekday, agg.hour, agg.total,
       ROUND(1.0 * agg.total / days.occurrences, 1) AS avg_per_week
FROM agg JOIN days ON days.weekday = agg.weekday
ORDER BY agg.weekday, agg.hour;

-- @report activity-calendar
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings),
agg AS (
  SELECT r.start_date AS day, COUNT(*) AS participations, COUNT(DISTINCT r.outing_id) AS outings
  FROM v_outing_rowers r, b
  WHERE r.start_at >= b.start_date AND r.start_at < b.end_date
    AND r.counts_in_stats = 1 AND r.is_rowing = 1
    AND (:boat_id IS NULL OR r.boat_id = :boat_id)
  GROUP BY r.start_date)
SELECT d.day AS date, COALESCE(agg.participations, 0) AS participations,
       COALESCE(agg.outings, 0) AS outings
FROM v_days d
CROSS JOIN b
LEFT JOIN agg ON agg.day = d.day
WHERE d.day >= b.start_date AND d.day < b.end_date
ORDER BY d.day;

-- @report coaching-balance
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings)
SELECT COALESCE(NULLIF(r.display_name, ''), r.rower_code) AS rower_label,
       r.age_category, r.seriousness,
       COUNT(*) AS outings,
       SUM(r.is_coached = 1) AS coached_outings,
       SUM(r.is_coached IS NULL) AS unknown_outings,
       ROUND(100.0 * SUM(r.is_coached = 1) / NULLIF(SUM(r.is_coached IS NOT NULL), 0), 0) AS coached_pct,
       MAX(CASE WHEN r.is_coached = 1 THEN r.start_date END) AS last_coached_date
FROM v_outing_rowers r, b
WHERE r.start_at >= b.start_date AND r.start_at < b.end_date
  AND r.counts_in_stats = 1 AND r.is_rowing = 1 AND r.rower_status = 'member'
  AND (:age_category IS NULL OR r.age_category = :age_category)
GROUP BY r.rower_id
HAVING COUNT(*) >= :min_outings
ORDER BY coached_pct ASC NULLS FIRST, outings DESC;

-- @report safety-summary
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings)
SELECT o.start_month_key AS month,
       SUM(o.return_delay_min > :tolerance_min) AS late_returns,
       SUM(o.estimated_end_at IS NULL) AS no_estimated_end,
       SUM(o.end_at IS NULL AND o.start_at < strftime('%Y-%m-%dT%H:%M', st.now, '-1 day')) AS not_closed
FROM v_outings o, b, v_settings st
WHERE o.start_at >= b.start_date AND o.start_at < b.end_date AND o.is_rowing = 1
GROUP BY o.start_month_key
ORDER BY o.start_month_key;

-- @report safety-issues
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings),
flagged AS (
  SELECT o.outing_id, o.start_at, o.boat_name, o.boat_class, o.crew_size,
         o.estimated_end_at, o.end_at, o.return_delay_min,
         CASE
           WHEN o.end_at IS NULL AND o.start_at < strftime('%Y-%m-%dT%H:%M', st.now, '-1 day') THEN 'not_closed'
           WHEN o.return_delay_min > :tolerance_min THEN 'late_return'
           WHEN o.estimated_end_at IS NULL THEN 'no_estimated_end'
           WHEN o.is_coached = 0 AND EXISTS (
             SELECT 1 FROM main.outing_crew oc JOIN main.rower rw ON rw.id = oc.rower_id
             WHERE oc.outing_id = o.outing_id AND rw.age_category IN ('J10', 'J12', 'J14', 'J16'))
             THEN 'youth_not_coached'
         END AS issue
  FROM v_outings o, b, v_settings st
  WHERE o.start_at >= b.start_date AND o.start_at < b.end_date AND o.is_rowing = 1)
SELECT issue, start_at, boat_name, boat_class, crew_size, estimated_end_at, end_at, return_delay_min
FROM flagged
WHERE issue IS NOT NULL AND (:issue IS NULL OR issue = :issue)
ORDER BY CASE issue WHEN 'not_closed' THEN 1 WHEN 'youth_not_coached' THEN 2
                    WHEN 'late_return' THEN 3 ELSE 4 END,
         start_at DESC
LIMIT 1000;

-- @report boat-km
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings),
s AS (
  SELECT o.boat_id, ROUND(SUM(o.distance_km), 0) AS km_season, COUNT(*) AS outings_season,
         ROUND(SUM(CASE WHEN o.is_multi_day = 0 AND o.duration_min > 0 THEN o.duration_min END) / 60.0, 1) AS hours_season
  FROM v_outings o, b
  WHERE o.start_at >= b.start_date AND o.start_at < b.end_date
  GROUP BY o.boat_id),
t AS (
  SELECT o.boat_id, ROUND(SUM(o.distance_km), 0) AS km_total, ROUND(SUM(CASE WHEN o.is_multi_day = 0 AND o.duration_min > 0 THEN o.duration_min END) / 60.0, 1) AS hours_total
  FROM v_outings o GROUP BY o.boat_id),
i AS (
  SELECT boat_id, COUNT(*) AS incidents_total, SUM(season = :season) AS incidents_season
  FROM v_incidents GROUP BY boat_id)
SELECT vb.boat_name, vb.boat_class, vb.build_year,
       s.km_season, s.hours_season, COALESCE(s.outings_season, 0) AS outings_season,
       t.km_total, t.hours_total,
       COALESCE(i.incidents_season, 0) AS incidents_season,
       COALESCE(i.incidents_total, 0) AS incidents_total
FROM v_boats vb
LEFT JOIN s ON s.boat_id = vb.boat_id
LEFT JOIN t ON t.boat_id = vb.boat_id
LEFT JOIN i ON i.boat_id = vb.boat_id
WHERE vb.is_archived = 0
ORDER BY s.km_season DESC NULLS LAST, outings_season DESC;

-- @report incidents-per-boat
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings),
o AS (
  SELECT boat_id, COUNT(*) AS outings FROM v_outings, b
  WHERE start_at >= b.start_date AND start_at < b.end_date GROUP BY boat_id)
SELECT i.boat_name, COUNT(*) AS incidents, MAX(i.occurred_date) AS last_incident_date,
       COALESCE(o.outings, 0) AS outings,
       ROUND(100.0 * COUNT(*) / NULLIF(o.outings, 0), 1) AS incidents_per_100_outings
FROM v_incidents i
CROSS JOIN b
LEFT JOIN o ON o.boat_id = i.boat_id
WHERE i.occurred_at >= b.start_date AND i.occurred_at < b.end_date
GROUP BY i.boat_id
ORDER BY incidents DESC, i.boat_name;

-- @report damages-per-boat
WITH b AS (
  SELECT printf('%04d-%02d-01', :season, season_start_month) AS start_date,
         printf('%04d-%02d-01', :season + 1, season_start_month) AS end_date,
         MIN(printf('%04d-%02d-01', :season + 1, season_start_month),
             date(today, '+1 day')) AS cutoff_date
  FROM v_settings)
SELECT d.boat_name,
       SUM(d.severity = 'unusable') AS unusable,
       SUM(d.severity = 'limited') AS limited,
       SUM(d.severity = 'usable') AS usable,
       SUM(d.is_open) AS open_damages,
       ROUND(AVG(CASE WHEN d.is_open = 0 THEN d.days_open END), 0) AS avg_days_to_fix,
       ROUND(SUM(d.repair_cost), 2) AS repair_cost
FROM v_damages d, b
WHERE d.reported_at >= b.start_date AND d.reported_at < b.end_date AND d.damage_kind = 'damage'
GROUP BY d.boat_id
ORDER BY COUNT(*) DESC, d.boat_name;
