-- Quotas are stored before allocation; a team claims one of the planned slots.
ALTER TABLE club.team_members ADD COLUMN IF NOT EXISTS is_vice_captain boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS one_vice_captain_per_team ON club.team_members(team_id) WHERE is_vice_captain;
CREATE TABLE IF NOT EXISTS club.team_allocation_slots (
 event_id uuid NOT NULL REFERENCES club.events(id) ON DELETE CASCADE,
 slot integer NOT NULL CHECK(slot>0),
 first_year_quota integer NOT NULL CHECK(first_year_quota>=0),
 team_id uuid UNIQUE,
 PRIMARY KEY(event_id,slot),
 FOREIGN KEY(team_id,event_id) REFERENCES club.teams(id,event_id)
);
ALTER TABLE club.team_allocation_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON club.team_allocation_slots FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION club.claim_team_allocation_slot() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE chosen integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM club.team_allocation_slots WHERE event_id=NEW.event_id) THEN RETURN NEW; END IF;
 SELECT slot INTO chosen FROM club.team_allocation_slots WHERE event_id=NEW.event_id AND team_id IS NULL ORDER BY slot LIMIT 1 FOR UPDATE;
 IF chosen IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='All planned team slots are already assigned'; END IF;
 UPDATE club.team_allocation_slots SET team_id=NEW.id WHERE event_id=NEW.event_id AND slot=chosen;
 RETURN NEW;
END $$;
CREATE TRIGGER claim_team_allocation_slot AFTER INSERT ON club.teams FOR EACH ROW EXECUTE FUNCTION club.claim_team_allocation_slot();

CREATE OR REPLACE FUNCTION club.enforce_first_year_quota() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE quota integer; capacity integer; members integer; first_years integer; leader_year integer; candidate_year integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.team_id=OLD.team_id AND NEW.registration_id=OLD.registration_id THEN RETURN NEW; END IF;
  NEW.is_vice_captain:=false;
 END IF;
 SELECT e.team_size-1,p.academic_year INTO capacity,leader_year FROM club.teams t
 JOIN club.events e ON e.id=t.event_id JOIN club.event_leaders l ON l.id=t.leader_id
 JOIN club.participant_profiles p ON p.user_id=l.user_id WHERE t.id=NEW.team_id FOR UPDATE OF t;
 SELECT first_year_quota INTO quota FROM club.team_allocation_slots WHERE team_id=NEW.team_id;
 IF quota IS NULL THEN RETURN NEW; END IF;
 SELECT count(*),count(*) FILTER(WHERE p.academic_year=1) INTO members,first_years
 FROM club.team_members m JOIN club.registrations r ON r.id=m.registration_id
 JOIN club.participant_profiles p ON p.user_id=r.user_id
 WHERE m.team_id=NEW.team_id AND m.registration_id<>NEW.registration_id;
 first_years:=first_years+CASE WHEN leader_year=1 THEN 1 ELSE 0 END;
 SELECT p.academic_year INTO candidate_year FROM club.registrations r JOIN club.participant_profiles p ON p.user_id=r.user_id WHERE r.id=NEW.registration_id;
 IF members>=capacity THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Team full'; END IF;
 IF candidate_year=1 AND first_years>=quota THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='This team has reached its first-year quota'; END IF;
 IF candidate_year IS DISTINCT FROM 1 AND capacity-members<=quota-first_years THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Remaining places are reserved for first-year students';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enforce_first_year_quota BEFORE INSERT OR UPDATE ON club.team_members FOR EACH ROW EXECUTE FUNCTION club.enforce_first_year_quota();

-- Changing the leader or a participant's year must not silently change saved counts.
CREATE OR REPLACE FUNCTION club.check_allocation_leader() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE quota integer; first_years integer; total integer; size integer; year integer;
BEGIN
 SELECT first_year_quota INTO quota FROM club.team_allocation_slots WHERE team_id=NEW.id;
 IF quota IS NULL THEN RETURN NEW; END IF;
 SELECT p.academic_year INTO year FROM club.event_leaders l JOIN club.participant_profiles p ON p.user_id=l.user_id WHERE l.id=NEW.leader_id;
 SELECT count(*),count(*) FILTER(WHERE p.academic_year=1) INTO total,first_years FROM club.team_members m JOIN club.registrations r ON r.id=m.registration_id JOIN club.participant_profiles p ON p.user_id=r.user_id WHERE m.team_id=NEW.id;
 first_years:=first_years+CASE WHEN year=1 THEN 1 ELSE 0 END;
 SELECT team_size INTO size FROM club.events WHERE id=NEW.event_id;
 IF first_years>quota OR quota-first_years>size-1-total THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Leader change would violate the first-year quota'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_allocation_leader BEFORE UPDATE OF leader_id ON club.teams FOR EACH ROW WHEN(OLD.leader_id IS DISTINCT FROM NEW.leader_id) EXECUTE FUNCTION club.check_allocation_leader();

CREATE OR REPLACE FUNCTION club.protect_allocated_academic_year() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM club.team_members m JOIN club.registrations r ON r.id=m.registration_id JOIN club.team_allocation_slots s ON s.team_id=m.team_id WHERE r.user_id=NEW.user_id)
 OR EXISTS(SELECT 1 FROM club.event_leaders l JOIN club.teams t ON t.leader_id=l.id JOIN club.team_allocation_slots s ON s.team_id=t.id WHERE l.user_id=NEW.user_id) THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Academic year is fixed after team allocation. Contact the organizer.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_allocated_academic_year BEFORE UPDATE OF academic_year ON club.participant_profiles FOR EACH ROW WHEN(OLD.academic_year IS DISTINCT FROM NEW.academic_year) EXECUTE FUNCTION club.protect_allocated_academic_year();
