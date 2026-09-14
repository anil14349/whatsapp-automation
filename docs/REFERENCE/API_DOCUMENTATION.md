# API Documentation - ABC Clinic WhatsApp Automation

## Overview

REST APIs for Doctor, Receptionist, and Admin portals. All endpoints require JWT authentication via `Authorization: Bearer <token>` header.

**Base URL**: `https://your-supabase-url/functions/v1/api`

---

## Authentication

### JWT Token Structure

```typescript
{
  userId: string;          // Unique user ID
  email: string;           // User email
  role: "DOCTOR" | "RECEPTIONIST" | "ADMIN" | "CLINIC_OWNER";
  clinicId?: string;       // Clinic ID for clinic-scoped operations
  doctorId?: string;       // Doctor ID (for DOCTOR role)
  iat: number;             // Issued at (Unix timestamp)
  exp: number;             // Expires at (Unix timestamp)
}
```

### Authorization Header

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOi...
```

### HTTP Status Codes

- **200**: Success
- **201**: Created (for POST requests)
- **400**: Bad Request (validation error)
- **401**: Unauthorized (missing/invalid token)
- **403**: Forbidden (insufficient permissions)
- **404**: Not Found
- **500**: Server Error

---

## Doctor APIs

### 1. Doctor Login

**Endpoint**: `POST /doctors/auth/login`

**Description**: Authenticate doctor with email and PIN

**Request**:
```json
{
  "email": "doctor@example.com",
  "pin": "1234",
  "clinicId": "clinic-uuid"
}
```

**Response** (200):
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "24h",
  "doctor": {
    "id": "doctor-uuid",
    "name": "Dr. John Doe",
    "email": "doctor@example.com",
    "clinic": {
      "id": "clinic-uuid",
      "name": "ABC Clinic"
    }
  }
}
```

**Error Response** (400):
```json
{
  "error": "Invalid PIN"
}
```

**cURL Example**:
```bash
curl -X POST https://your-supabase.functions.supabase.co/v1/api/doctors/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "doctor@example.com",
    "pin": "1234",
    "clinicId": "clinic-123"
  }'
```

---

### 2. Get Doctor Profile

**Endpoint**: `GET /doctors/auth/me`

**Description**: Get current authenticated doctor's profile

**Headers**:
```http
Authorization: Bearer <token>
```

**Response** (200):
```json
{
  "id": "doctor-uuid",
  "name": "Dr. John Doe",
  "email": "doctor@example.com",
  "phone": "+91...",
  "specialization": "General Practitioner",
  "clinic": {
    "id": "clinic-uuid",
    "name": "ABC Clinic",
    "location": "Mumbai"
  }
}
```

**cURL Example**:
```bash
curl -X GET https://your-supabase.functions.supabase.co/v1/api/doctors/auth/me \
  -H "Authorization: Bearer <token>"
```

---

### 3. List Doctor Appointments

**Endpoint**: `GET /doctors/appointments`

**Description**: List appointments for authenticated doctor

**Query Parameters**:
- `date` (optional): Filter by date (YYYY-MM-DD). Default: today
- `status` (optional): Filter by status (CONFIRMED|COMPLETED|NO_SHOW|CANCELLED)

**Response** (200):
```json
{
  "appointments": [
    {
      "id": "apt-uuid",
      "date": "2026-09-15",
      "time": "10:00",
      "status": "CONFIRMED",
      "patient": {
        "id": "patient-uuid",
        "name": "John Doe",
        "phone": "+91..."
      },
      "doctor": {
        "id": "doctor-uuid",
        "name": "Dr. Jane"
      },
      "notes": "Consultation for checkup",
      "completedAt": null,
      "createdAt": "2026-09-14T15:30:00Z"
    }
  ],
  "total": 5,
  "date": "2026-09-15",
  "filtered": {
    "status": "CONFIRMED"
  }
}
```

**cURL Example**:
```bash
# Get today's appointments
curl -X GET https://your-supabase.functions.supabase.co/v1/api/doctors/appointments \
  -H "Authorization: Bearer <token>"

# Get specific date
curl -X GET "https://your-supabase.functions.supabase.co/v1/api/doctors/appointments?date=2026-09-15" \
  -H "Authorization: Bearer <token>"

# Get completed appointments
curl -X GET "https://your-supabase.functions.supabase.co/v1/api/doctors/appointments?status=COMPLETED" \
  -H "Authorization: Bearer <token>"
```

---

### 4. Update Appointment Status

**Endpoint**: `PUT /doctors/appointments/:appointmentId/status`

**Description**: Mark appointment as COMPLETED or NO_SHOW

**Path Parameters**:
- `appointmentId`: UUID of appointment

**Request**:
```json
{
  "status": "COMPLETED",
  "notes": "Patient recovered well"
}
```

**Response** (200):
```json
{
  "id": "apt-uuid",
  "status": "COMPLETED",
  "completedAt": "2026-09-15T10:30:00Z",
  "updatedAt": "2026-09-15T10:30:00Z"
}
```

**Error Response** (400):
```json
{
  "error": "Cannot update appointment already marked as COMPLETED"
}
```

**cURL Example**:
```bash
curl -X PUT https://your-supabase.functions.supabase.co/v1/api/doctors/appointments/apt-123/status \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "COMPLETED",
    "notes": "Patient recovered well"
  }'
```

---

## Receptionist APIs

### 1. Receptionist Login

**Endpoint**: `POST /receptionists/auth/login`

**Description**: Authenticate receptionist with email and password

**Request**:
```json
{
  "email": "receptionist@example.com",
  "password": "secure-password",
  "clinicId": "clinic-uuid"
}
```

**Response** (200):
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "24h",
  "receptionist": {
    "id": "receptionist-uuid",
    "name": "Jane Doe",
    "email": "receptionist@example.com",
    "clinic": {
      "id": "clinic-uuid",
      "name": "ABC Clinic"
    }
  }
}
```

**cURL Example**:
```bash
curl -X POST https://your-supabase.functions.supabase.co/v1/api/receptionists/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "receptionist@example.com",
    "password": "secure-password",
    "clinicId": "clinic-123"
  }'
```

---

### 2. List Clinic Appointments

**Endpoint**: `GET /receptionists/appointments`

**Description**: List all appointments in clinic (for receptionist)

**Query Parameters**:
- `date` (optional): Filter by date (YYYY-MM-DD)
- `status` (optional): Filter by status

**Response** (200):
```json
{
  "appointments": [
    {
      "id": "apt-uuid",
      "appointment_date": "2026-09-15",
      "appointment_time": "10:00",
      "status": "CONFIRMED",
      "patient_name": "John Doe",
      "patient_phone": "+91...",
      "patient_email": "john@example.com",
      "doctor_id": "doctor-uuid",
      "doctor_name": "Dr. Jane",
      "notes": "Checkup",
      "preferred_language": "EN",
      "created_at": "2026-09-14T15:30:00Z"
    }
  ],
  "total": 8,
  "date": "2026-09-15"
}
```

**cURL Example**:
```bash
curl -X GET "https://your-supabase.functions.supabase.co/v1/api/receptionists/appointments?date=2026-09-15" \
  -H "Authorization: Bearer <token>"
```

---

### 3. Create Appointment

**Endpoint**: `POST /receptionists/appointments`

**Description**: Create new appointment for patient

**Request**:
```json
{
  "patientName": "John Doe",
  "patientPhone": "+91-9876543210",
  "patientEmail": "john@example.com",
  "doctorId": "doctor-uuid",
  "appointmentDate": "2026-09-15",
  "appointmentTime": "10:00",
  "notes": "Consultation for checkup",
  "preferredLanguage": "EN"
}
```

**Response** (201):
```json
{
  "id": "apt-uuid",
  "appointmentDate": "2026-09-15",
  "appointmentTime": "10:00",
  "status": "CONFIRMED",
  "patientName": "John Doe",
  "patientPhone": "+91-9876543210",
  "doctorName": "Dr. Jane",
  "createdAt": "2026-09-14T15:35:00Z"
}
```

**Error Response** (400):
```json
{
  "error": "Doctor not found or does not belong to this clinic"
}
```

**cURL Example**:
```bash
curl -X POST https://your-supabase.functions.supabase.co/v1/api/receptionists/appointments \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "patientName": "John Doe",
    "patientPhone": "+91-9876543210",
    "patientEmail": "john@example.com",
    "doctorId": "doc-123",
    "appointmentDate": "2026-09-15",
    "appointmentTime": "10:00",
    "notes": "Checkup",
    "preferredLanguage": "EN"
  }'
```

---

## Common Error Responses

### 401 Unauthorized
```json
{
  "error": "Missing or invalid authentication token"
}
```

### 403 Forbidden
```json
{
  "error": "This endpoint requires role: DOCTOR, RECEPTIONIST"
}
```

### 404 Not Found
```json
{
  "error": "Appointment not found"
}
```

### 400 Bad Request
```json
{
  "error": "Missing required fields: email, pin, clinicId"
}
```

### 500 Server Error
```json
{
  "error": "Server configuration error"
}
```

---

## Environment Variables Required

```bash
SB_URL=https://your-project.supabase.co
SB_SERVICE_ROLE_KEY=your-service-role-key
JWT_SECRET=your-jwt-secret-key
```

---

## Rate Limiting

*Not yet implemented. To be added in production*:
- 100 requests per minute per user
- 10 failed login attempts → 15 minute lockout

---

## API Versioning

Current version: **v1**

All endpoints follow the pattern: `/functions/v1/api/...`

---

## Testing APIs Locally

### Start Supabase Functions Locally

```bash
cd supabase
supabase functions serve
```

Functions will be available at: `http://localhost:54321/functions/v1/api/...`

### Test Doctor Login

```bash
curl -X POST http://localhost:54321/functions/v1/api/doctors/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "doctor@example.com",
    "pin": "1234",
    "clinicId": "clinic-123"
  }'
```

---

## Next Steps

- [ ] Implement Admin APIs (clinic management, user management)
- [ ] Add rate limiting and API throttling
- [ ] Implement request/response logging
- [ ] Add API key authentication for third-party integrations
- [ ] Create Swagger/OpenAPI documentation
- [ ] Implement API versioning strategy
- [ ] Add request validation middleware
- [ ] Implement response caching
- [ ] Set up API monitoring and alerting

---

## Support

For issues or questions about the APIs:
1. Check the error message in the response
2. Verify JWT token is valid
3. Ensure clinic_id matches user's clinic
4. Check Supabase logs: `supabase functions logs`
