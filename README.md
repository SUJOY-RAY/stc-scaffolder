# STC Java Bootstrapper — Standard Template Construct

A dynamic Java Spring Boot project bootstrapper. Prompts for project name, package, artifact, user fields, Java version and MySQL config, then auto-generates a full Java project from a reference template (all names/paths/package names replaced dynamically).

## Quick start

```bash
# Clone or copy this folder, then:
cd stc-scaffolder
npm install          # optional — only Node.js built-ins are used
node index.js        # bootstrap a new Java Spring Boot project interactively
npm start            # same as node index.js
```

## Usage

```bash
# Interactive bootstrap (also generates Thymeleaf listings for all @Entity models)
node index.js

# Add CRUD for a new entity to an already-generated project
node index.js crud:add <path-to-existing-project>

# (Re)generate Thymeleaf paginated listings for all @Entity models in a project
node index.js th:add <path-to-existing-project>
```

## What it generates

- A Maven Spring Boot project (Java 21 / Spring Boot 4.1.2 by default)
- JWT authentication (login `/api/auth/signin`, signup `/api/auth/signup`)
- Spring Security with stateless sessions, BCrypt password encoding
- Auto-seeded default admin account: `admin` / `admin123`
- Auto-generated CRUD for the `User` entity under `/api/users`
- Auto-generated Thymeleaf paginated, globally searchable and sortable listing page for **every** `@Entity` class (e.g. `/users`, `/roles`) under `src/main/resources/templates/`
- H2 (dev, no database server required) and MySQL (dev-mysql / qa / prod) profiles
- `STC-SUMMARY.md` with project details and next steps

## Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/auth/signin` | Login, returns JWT | Public |
| POST | `/api/auth/signup` | Register new user | Public |
| GET | `/api/users` | List users | Authenticated |
| GET | `/api/users/{id}` | Get user by id | Authenticated |
| POST | `/api/users` | Create user | Authenticated |
| PUT | `/api/users/{id}` | Update user | Authenticated |
| DELETE | `/api/users/{id}` | Delete user | Authenticated |

## Running the generated project

```bash
# H2 dev profile (default — no database server needed)
cd <your-generated-project>
.\mvnw.cmd spring-boot:run          # Windows
./mvnw spring-boot:run              # macOS/Linux

# MySQL dev profile
# 1. Create the database: CREATE DATABASE <name>_dev;
# 2. Edit application-dev-mysql.properties credentials if needed
.\mvnw.cmd spring-boot:run --spring.profiles.active=dev-mysql   # Windows
./mvnw spring-boot:run --spring.profiles.active=dev-mysql       # macOS/Linux
```

> If Spring Boot complains about duplicate main classes (`__MAIN__`), run `.\mvnw.cmd clean` first to clear stale build output.

## Thymeleaf entity listings

Every class annotated with `@Entity` gets a server-rendered listing page:

- **URL:** `GET /<entity-plural>` (e.g. `/users`, `/roles`) — a `@Controller` (not `@RestController`), so it returns HTML, not JSON.
- **Pagination:** Spring Data `Pageable` with `page`/`size` query params and First/Prev/Next/Last + page-number controls.
- **Global search:** `?search=` runs a JPA `Specification` — contains (case-insensitive) match over text columns and exact match over numeric/boolean columns.
- **Sortable:** click any column header to toggle ascending/descending (`?sort=`/`?dir=`).
- **Template:** `src/main/resources/templates/<entity-plural>.html` (Bootstrap 5 via CDN).
- **Security:** the generated `SecurityConfig` permits `GET` page loads so the tables open without a JWT; the `/api/**` REST endpoints stay protected.

Delete rows call the existing REST `DELETE /api/<entity>/{id}` (CSRF is disabled in the template). View/Edit buttons are placeholders to wire to your detail/edit forms.

## Django-style admin (`/db`) — ADMIN only

In addition to the public listings, a full admin is generated under `/db` for every `@Entity`:

- **Dashboard:** `GET /db` lists all tables/entities with links to each admin section.
- **Per-entity admin:** `GET /db/<plural>` — paginated, searchable, sortable table with full CRUD:
  - **View** `GET /db/<plural>/{id}`
  - **Create** `GET/POST /db/<plural>/new`
  - **Edit** `GET/POST /db/<plural>/{id}/edit`
  - **Delete** `POST /db/<plural>/{id}/delete` (with confirmation)
- **Access control:** `/db/**` is restricted to users with the `ADMIN` role (`@PreAuthorize("hasRole('ADMIN')")` on every admin controller + `SecurityConfig` rule). The default seeded user `admin`/`admin123` has the ADMIN role, so log in as `admin` to reach `/db`.
- **Templates:** `templates/<plural>.html` (list), `<plural>-form.html` (create/edit), `<plural>-view.html` (detail).

Example URLs:
- `GET /db` — admin dashboard (all tables)
- `GET /db/users` — User table (paginated, search, sort)
- `GET /db/users/new` — create a User
- `GET /db/users/42` — view User #42
- `GET /db/users/42/edit` — edit User #42

## Default credentials

After the app starts, a default admin user is seeded:

- **Username:** `admin`
- **Password:** `admin123`
- **Email:** `admin@<artifact>.com`

> Change the JWT secret (`jwt.secret`) and default password before production.

## Non-interactive / CI usage

Answers can be piped via stdin, one per line:

```bash
printf 'my-project\nmy-project\ncom.acme\n0.0.1-SNAPSHOT\n21\n4.1.2\n\nlocalhost\n3306\nroot\n\n' | node index.js
```

Line order: project name, artifactId, groupId, version, Java version, Spring Boot version, (blank to skip custom fields), DB host, DB port, DB user, DB password.

## Project structure

```
stc-scaffolder/
├── index.js              # bootstrapper entry point
├── package.json
├── lib/
│   ├── crud.js           # CRUD generator (controller, service, DTOs)
│   ├── files.js          # copy / repackage helpers
│   ├── prompts.js        # readline question helper
│   ├── summary.js        # STC-SUMMARY.md builder
│   ├── templates.js      # token replacement + User.java generator
│   └── utils.js          # case helpers
└── templates/            # reference Spring Boot template
    ├── pom.xml
    ├── src/main/java/com/example/demo/...
    └── src/main/resources/application*.properties
```

## Requirements

- Node.js >= 18
- Java >= 21 (to run generated projects)
- Maven wrapper (`mvnw`) is included in generated projects

## License

MIT
