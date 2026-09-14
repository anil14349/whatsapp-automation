# Supabase Edge Functions

This directory contains the Supabase Edge Functions that replace the Google Apps Script backend for the ABC Clinic WhatsApp automation system.

## Directory Structure

```
functions/
├── webhook/
│   └── index.ts                  # Main webhook handler (GET/POST)
├── api/
│   ├── appointments.ts           # Appointment CRUD operations
│   ├── doctors.ts                # Doctor operations
│   ├── slots.ts                  # Available slots calculation
│   └── sessions.ts               # Session management API
├── shared/
│   ├── types.ts                  # TypeScript types and interfaces
│   ├── validators.ts             # Input validation functions
│   ├── logger.ts                 # Logging and audit functions
│   ├── whatsapp-client.ts        # WhatsApp API client
│   ├── message-processor.ts      # Message routing logic
│   ├── google-sheets.ts          # Google Sheets integration
│   └── google-calendar.ts        # Google Calendar integration
├── utils/
│   ├── cache.ts                  # Caching helpers
│   ├── date-time.ts              # Date/time utilities
│   └── config.ts                 # Configuration loader
└── README.md                     # This file
```

## Functions Overview

### `/webhook` (Public)

Main entry point for WhatsApp Cloud API webhooks.

**GET** - Webhook verification
```bash
curl "https://your-project.supabase.co/functions/v1/webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=TEST"
```

**POST** - Receive inbound messages
```bash
curl -X POST "https://your-project.supabase.co/functions/v1/webhook?token=YOUR_WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entry":[{"changes":[{"value":{"messages":[...]}}]}]}'
```

### `/api/appointments` (Protected)

Appointment CRUD operations. Requires authentication.

```bash
# Create appointment
POST /api/appointments
Authorization: Bearer <token>
{
  "doctorId": "D001",
  "phone": "919876543210",
  "date": "2026-09-15",
  "time": "10:00",
  "patientName": "John Doe"
}

# Get appointments for phone
GET /api/appointments?phone=919876543210

# Cancel appointment
DELETE /api/appointments/:appointmentId

# Reschedule appointment
PUT /api/appointments/:appointmentId
{
  "date": "2026-09-16",
  "time": "14:00"
}
```

### `/api/doctors` (Protected)

Doctor operations.

```bash
# Get all doctors
GET /api/doctors

# Get doctor schedule
GET /api/doctors/:doctorId/schedule?date=2026-09-15

# Update doctor availability
POST /api/doctors/:doctorId/availability
{
  "day": "Mon",
  "sessions": [{"start": "09:00", "end": "12:00"}, ...]
}
```

### `/api/slots` (Protected)

Available slot calculation.

```bash
# Get available slots for doctor and date
GET /api/slots?doctorId=D001&date=2026-09-15

# Get available slots for date range
GET /api/slots?doctorId=D001&startDate=2026-09-15&endDate=2026-09-30
```

### `/api/sessions` (Protected)

Session management for internal use.

```bash
# Get user session
GET /api/sessions/:phone

# Update session
PATCH /api/sessions/:phone
{
  "state": "BOOK_DOCTOR",
  "data": {"doctorId": "D001"}
}

# Clear session
DELETE /api/sessions/:phone
```

## Development

### Prerequisites

- Deno runtime (included with Supabase CLI)
- Supabase CLI
- Node.js 18+ (for running local dev server)

### Local Development

```bash
# Start Supabase local environment
supabase start

# Serve functions locally
supabase functions serve

# Functions are available at http://localhost:54321/functions/v1/*
```

### Environment Variables

Create `.env.local` in the project root:

```
SB_URL=http://localhost:54321
SB_ANON_KEY=xxx
SB_SERVICE_ROLE_KEY=xxx
WHATSAPP_ACCESS_TOKEN=xxx
WHATSAPP_PHONE_NUMBER_ID=xxx
WHATSAPP_VERIFY_TOKEN=xxx
WHATSAPP_WEBHOOK_POST_TOKEN=xxx
GOOGLE_SHEETS_ID=xxx
GOOGLE_SHEETS_PRIVATE_KEY=xxx
GOOGLE_SHEETS_CLIENT_EMAIL=xxx
DEBUG_MODE=true
TIMEZONE=Asia/Kolkata
```

### Testing

```bash
# Test webhook verification
curl "http://localhost:54321/functions/v1/webhook?hub.mode=subscribe&hub.verify_token=test&hub.challenge=challenge123"

# Test inbound message
curl -X POST "http://localhost:54321/functions/v1/webhook?token=test-token" \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "from": "919876543210",
            "id": "msg123",
            "type": "text",
            "text": {"body": "hi"}
          }],
          "contacts": [{"profile": {"name": "Test User"}}],
          "metadata": {"phone_number_id": "123456789"}
        }
      }]
    }]
  }'
```

## Deployment

### Deploy to Production

```bash
# Link to Supabase project
supabase link --project-ref your-project-ref

# Deploy all functions
supabase functions deploy

# Deploy specific function
supabase functions deploy webhook
supabase functions deploy api/appointments
```

### Using GitHub Actions

See `.github/workflows/deploy.yml` for CI/CD setup.

## Logging & Debugging

### View Function Logs

```bash
# Using CLI
supabase functions list
supabase functions logs webhook --limit 100

# Or in Supabase dashboard
# Navigate to: Functions → Select function → Logs tab
```

### Debug Output

Set `DEBUG_MODE=true` to enable verbose logging in development.

## Performance Considerations

### Cold Starts

Edge Functions have a cold start latency (~1-2 seconds on first invocation after deployment). To minimize:

1. **Keep functions small** - Split large functions into smaller ones
2. **Use warm-up requests** - Periodically call functions to keep them warm
3. **Optimize imports** - Import only what you need
4. **Cache aggressively** - Use Supabase cache for frequently accessed data

### Concurrency

Supabase Edge Functions can handle thousands of concurrent requests. No additional scaling needed.

## Monitoring

### Key Metrics to Track

1. **Request Rate** - Requests per minute
2. **Error Rate** - % of failed requests
3. **Latency** - P50, P95, P99 response times
4. **Database Connections** - Active connections to Supabase
5. **Cache Hit Rate** - Effectiveness of caching strategy

Use Supabase dashboard or Datadog integration for monitoring.

## Common Issues

### 401 Unauthorized on Webhook

**Cause**: Webhook token mismatch

**Solution**: Verify `WHATSAPP_WEBHOOK_POST_TOKEN` matches in URL:
```bash
# Check URL has correct token
https://your-project.supabase.co/functions/v1/webhook?token=YOUR_WEBHOOK_POST_TOKEN
```

### 404 Function Not Found

**Cause**: Function not deployed

**Solution**: 
```bash
supabase functions list  # Verify function exists
supabase functions deploy webhook  # Deploy it
```

### Database Connection Errors

**Cause**: Service role key not configured, database down, or RLS policy blocking

**Solution**:
1. Check `SB_SERVICE_ROLE_KEY` in function settings
2. Verify Supabase project is active
3. Check RLS policies allow service role access

### Google Sheets Timeout

**Cause**: Large sheet, slow API, network issues

**Solution**:
1. Implement caching for frequent reads
2. Use sheet ranges instead of entire sheet
3. Add retry logic with exponential backoff

## Next Steps

1. ✅ Review function structure
2. → [Implement business logic](../BUSINESS_LOGIC.md)
3. → [Set up monitoring](../MONITORING.md)
4. → [Deploy to production](./DEPLOYMENT.md)
