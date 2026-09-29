# TickXplore

**TickXplore** is a transport booking platform that lets users book **bus tickets** and **vehicle reservations** across destinations in Nepal. It provides separate dashboards for **Users**, **Vendors**, and **Admins** to manage bookings, transport, and refunds.

The project is split into two parts:

| Folder       | Description                     | Tech Stack                                |
| ------------ | ------------------------------- | ----------------------------------------- |
| `Back_End`   | REST API server                 | Node.js, Express, MongoDB (Mongoose), JWT |
| `Front_End`  | Web application (all dashboards) | React + Vite + TypeScript, Tailwind CSS, Firebase Auth |

---

## Prerequisites

- **Node.js** (v18 or later)
- **npm**
- **MongoDB** (local `mongod` or a cloud cluster such as MongoDB Atlas)

---

## Environment Setup (single `.env` at repo root)

The whole project uses **one** environment file at the repository root: `.env`.

Create it and fill in real values. It serves **both** parts:
- **Backend** loads it via `Back_End/index.js` (`dotenv` reads `../.env`).
- **Frontend** loads it via `Front_End/vite.config.js` (`envDir: '..'`).

Example layout:

```env
# --- Backend ---
PORT=3001
MONGO_URI=mongodb://localhost:27017/tickxplore
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret
KHALTI_SECRET_KEY=your_khalti_secret
KHALTI_RETURN_URL=http://localhost:5173/payment/callback
KHALTI_WEBSITE_URL=http://localhost:5173
EMAIL_USER=your_email
EMAIL_PASS=your_email_password
HUGGINGFACE_API_KEY=your_huggingface_key
CLIENT_URL=http://localhost:5173

# Firebase Admin SDK (backend) - file lives at Back_End/config/serviceAccountKey.json
FIREBASE_SERVICE_ACCOUNT_PATH=config/serviceAccountKey.json

# --- Frontend ---
VITE_API_URL=http://localhost:3001
VITE_HF_API_KEY=

# Firebase Web SDK (frontend)
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

> `.env` is git-ignored — never commit real secrets. `VITE_`-prefixed vars are exposed to the browser by Vite at build time.

## Firebase Setup

Authentication is handled by **Firebase Auth** (email/password + Google) for identity, while sessions, roles, and tokens stay JWT-based. The database itself stays in MongoDB.

1. Create a project at [Firebase Console](https://console.firebase.google.com).
2. In **Authentication → Sign-in method**, enable **Email/Password** and **Google**.
3. Add a **Web app** in Project settings; copy the `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, and `appId` into the `VITE_FIREBASE_*` vars above.
4. In **Project settings → Service accounts**, generate a new private key and save the JSON as `Back_End/config/serviceAccountKey.json` (git-ignored) — the `.env` already points at that path.
5. Until the two Firebase blocks above are filled, the **"Continue with Google"** button shows a "not configured" toast (backend returns 503) — everything else works.

## Google Sign-In (via Firebase)

The login page includes **"Continue with Google"**:

- Enable the **Google** provider in Firebase Console (this replaces the old raw OAuth client-ID flow — no separate Google Cloud Client ID is needed).
- New Google sign-ups are auto-created as verified **User** accounts. To become a vendor, a user applies from the **Profile page** ("Apply for Vendor"), which creates a pending Vendor that needs **admin approval** (Accept/Decline). Once approved, the next sign-in routes to the vendor dashboard.

---

## Backend Setup (`Back_End/`)

```bash
cd Back_End
npm install
```

Start the backend (auto-reloads via `nodemon`):

```bash
npm start
```

- Runs at **http://localhost:3001** · Health check: `GET /health`
- Images, logos, and uploads are served from `Back_End/uploads` (auto-created; sample images are committed to git so they exist on every clone).

---

## Frontend Setup (`Front_End/`)

Open a second terminal:

```bash
cd Front_End
npm install
```

Start the development server:

```bash
npm run dev
```

- Runs at **http://localhost:5173**.

---

## How to Use

1. Open **http://localhost:5173** and register a **User** account (or sign in).
2. On the homepage, select **Pickup Point**, **Dropping Point**, and **Date**, then click **Find Tickets** (all three are required).
3. Choose from **Available Buses** / **Available Vehicles**.
4. For buses, select seats on the seat-selection page; vehicles follow the reservation flow.
5. Pay with **Khalti** or **Cash on Visit**.
6. **Vendors** manage their buses/vehicles and bookings in `/VendorDashboard`.
7. **Admins** manage users, vendors, bookings, and refunds in `/Admin_Dashboard`.

---

## Project Structure

```
.
├── Back_End/
│   ├── config/          # App configuration (e.g. nodemailer)
│   ├── controllers/     # Request handlers per feature
│   ├── data/            # Static data (e.g. tourist-info.json)
│   ├── middleware/      # Auth & validation middleware
│   ├── models/          # Mongoose schemas (Bus, Vehicle, Booking, ...)
│   ├── routes/          # Express route definitions
│   ├── utils/           # Helpers (email, payments, ...)
│   ├── uploads/         # Runtime-uploaded images (git-ignored)
│   └── index.js         # Server entry point
└── Front_End/
    ├── public/          # Static assets, favicons, logo
    └── src/
        ├── api/         # Typed API client + shared types
        ├── Component/   # Reusable UI components
        ├── Pages/       # Route pages (tickets, seat selection, dashboards, ...)
        ├── router/      # React Router configuration
        └── home/        # Homepage entry
```

---

## Scripts

### Backend (`Back_End/`)
| Command      | Description                  |
| ------------ | ---------------------------- |
| `npm start`  | Start the API with `nodemon` |

### Frontend (`Front_End/`)
| Command              | Description                 |
| -------------------- | --------------------------- |
| `npm run dev`        | Start the Vite dev server   |
| `npm run build`      | Production build            |
| `npm run preview`    | Preview the production build|
| `npm run typecheck`  | Run the TypeScript checker  |
| `npm run lint`       | Run ESLint                  |

---

## Troubleshooting

- **CORS errors** — keep the frontend on `http://localhost:5173` (the backend only allows this origin by default).
- **MongoDB connection error at startup** — confirm `mongod` is running, or check `MONGO_URI`.
- **Images not loading** — make sure `Back_End/uploads` exists and `VITE_API_URL` matches the backend port.
