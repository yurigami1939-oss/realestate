-- Local infrastructure only. In other environments these roles are provisioned
-- by the platform with the same names (see CLAUDE.md §5 Multi-tenancy).

-- Owns the schema, runs migrations and seeds.
CREATE ROLE realestate_owner LOGIN PASSWORD 'owner' NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- Runtime role: never owner, never bypasses RLS.
CREATE ROLE realestate_app LOGIN PASSWORD 'app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- Lets the owner create the pgboss schema on behalf of the app role.
GRANT realestate_app TO realestate_owner;

CREATE DATABASE realestate OWNER realestate_owner;
CREATE DATABASE realestate_test OWNER realestate_owner;
CREATE DATABASE realestate_e2e OWNER realestate_owner;
