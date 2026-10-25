-- Allow a reserved vice-captain while team setup is incomplete.
-- Regular draws remain blocked; the API checks complete year-plan feasibility.
CREATE OR REPLACE FUNCTION club.enforce_first_year_quota() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE quota integer; capacity integer; members integer; first_years integer; leader_year integer; candidate_year integer; quotas jsonb; counts jsonb; item record; planned_capacity integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.team_id=OLD.team_id AND NEW.registration_id=OLD.registration_id THEN RETURN NEW; END IF;
  NEW.is_vice_captain:=false;
 END IF;
 SELECT COALESCE(s.team_capacity,e.team_size)-1,COALESCE(p.academic_year,0),s.first_year_quota,s.year_quotas,s.team_capacity INTO capacity,leader_year,quota,quotas,planned_capacity
 FROM club.teams t JOIN club.events e ON e.id=t.event_id JOIN club.event_leaders l ON l.id=t.leader_id
 JOIN club.participant_profiles p ON p.user_id=l.user_id LEFT JOIN club.team_allocation_slots s ON s.team_id=t.id WHERE t.id=NEW.team_id FOR UPDATE OF t;
 IF quota IS NULL THEN RETURN NEW; END IF;
 IF planned_capacity IS NOT NULL AND quotas IS NULL AND NOT NEW.is_vice_captain THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Allocation opens after all planned teams have active, confirmed captains'; END IF;
 SELECT count(*),count(*) FILTER(WHERE p.academic_year=1) INTO members,first_years FROM club.team_members m
 JOIN club.registrations r ON r.id=m.registration_id JOIN club.participant_profiles p ON p.user_id=r.user_id
 WHERE m.team_id=NEW.team_id AND m.registration_id<>NEW.registration_id;
 first_years:=first_years+CASE WHEN leader_year=1 THEN 1 ELSE 0 END;
 SELECT COALESCE(p.academic_year,0) INTO candidate_year FROM club.registrations r JOIN club.participant_profiles p ON p.user_id=r.user_id WHERE r.id=NEW.registration_id FOR SHARE OF p;
 IF members>=capacity THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Team full'; END IF;
 IF candidate_year=1 AND first_years>=quota THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='This team has reached its first-year quota'; END IF;
 IF candidate_year<>1 AND capacity-members<=quota-first_years THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Remaining places are reserved for first-year students'; END IF;
 IF quotas IS NOT NULL THEN
  IF NOT quotas ? candidate_year::text THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='No remaining places for this academic year'; END IF;
  SELECT COALESCE(jsonb_object_agg(year,n),'{}'::jsonb) INTO counts FROM (
   SELECT year,count(*) n FROM (
    SELECT COALESCE(p.academic_year,0) AS year FROM club.team_members m JOIN club.registrations r ON r.id=m.registration_id JOIN club.participant_profiles p ON p.user_id=r.user_id WHERE m.team_id=NEW.team_id AND m.registration_id<>NEW.registration_id
    UNION ALL SELECT leader_year
   ) players GROUP BY year
  ) totals;
  FOR item IN SELECT key,value::integer n FROM jsonb_each_text(quotas) LOOP
   IF COALESCE((counts->>item.key)::integer,0)+(CASE WHEN candidate_year::text=item.key THEN 1 ELSE 0 END)>item.n THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='This academic-year allocation is full; remaining places are reserved for other years';
   END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;

