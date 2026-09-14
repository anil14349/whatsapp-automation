# Testing Guide

Comprehensive testing strategies for ABC Clinic WhatsApp automation on Supabase Edge Functions.

## Test Environment Setup

### Prerequisites

```bash
# Install dependencies
npm install
supabase start

# Prepare test database
supabase db reset  # Start with clean database
```

### Test Configuration

Create `tests/config.ts`:

```typescript
export const TEST_CONFIG = {
    SB_URL: Deno.env.get("SB_URL") || "http://localhost:54321",
    SB_ANON_KEY: Deno.env.get("SB_ANON_KEY") || "eyJhbGc...",
    SB_SERVICE_ROLE_KEY: Deno.env.get("SB_SERVICE_ROLE_KEY") || "eyJhbGc...",
    WHATSAPP_VERIFY_TOKEN: "test-token",
    WHATSAPP_POST_TOKEN: "test-post-token",
    TEST_PHONE: "919876543210",
    TEST_DOCTOR_ID: "D001",
    TEST_SHEET_ID: "google-sheets-test-id"
};
```

---

## Unit Tests

### 1. Validators Tests

File: `tests/validators_test.ts`

```typescript
import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { 
    verifyWebhookToken,
    normalizePhoneNumber,
    phonesMatch,
    isValidISODate,
    isValidPatientName
} from "../functions/shared/validators.ts";

Deno.test("Phone Normalization", async (t) => {
    await t.step("Removes +", () => {
        assertEquals(normalizePhoneNumber("+919876543210"), "919876543210");
    });
    
    await t.step("Removes spaces and dashes", () => {
        assertEquals(
            normalizePhoneNumber("+91 98765-43210"),
            "919876543210"
        );
    });
    
    await t.step("Returns numeric only", () => {
        assertEquals(normalizePhoneNumber("919876543210"), "919876543210");
    });
});

Deno.test("Phone Matching", async (t) => {
    await t.step("Matches normalized numbers", () => {
        assertEquals(phonesMatch("+919876543210", "919876543210"), true);
        assertEquals(phonesMatch("+91 98765-43210", "919876543210"), true);
    });
    
    await t.step("Rejects different numbers", () => {
        assertEquals(phonesMatch("919876543210", "919876543211"), false);
    });
});

Deno.test("Date Validation", async (t) => {
    await t.step("Validates ISO dates", () => {
        assertEquals(isValidISODate("2026-09-15"), true);
        assertEquals(isValidISODate("2026-13-45"), false);
        assertEquals(isValidISODate("not-a-date"), false);
    });
});

Deno.test("Patient Name Validation", async (t) => {
    await t.step("Accepts valid names", () => {
        assertEquals(isValidPatientName("John Doe"), true);
        assertEquals(isValidPatientName("राज कुमार"), true);  // Hindi
    });
    
    await t.step("Rejects invalid names", () => {
        assertEquals(isValidPatientName("A"), false);  // Too short
        assertEquals(isValidPatientName("x".repeat(101)), false);  // Too long
        assertEquals(isValidPatientName(""), false);  // Empty
    });
});

// Run: deno test --allow-all tests/validators_test.ts
```

### 2. Logger Tests

File: `tests/logger_test.ts`

```typescript
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "@supabase/supabase-js";
import { logWhatsAppMessage, logError } from "../functions/shared/logger.ts";

const supabase = createClient(
    Deno.env.get("SB_URL")!,
    Deno.env.get("SB_SERVICE_ROLE_KEY")!
);

Deno.test("Logger", async (t) => {
    await t.step("Logs message to database", async () => {
        await logWhatsAppMessage(supabase, {
            direction: "INBOUND",
            phone: "919876543210",
            name: "Test User",
            status: "TEXT",
            message: "test message"
        });
        
        const { data } = await supabase
            .from("whatsapp_log")
            .select("*")
            .eq("phone", "919876543210")
            .maybeSingle();
            
        assertEquals(data?.message, "test message");
    });
    
    await t.step("Logs errors", async () => {
        const error = new Error("Test error");
        await logError(supabase, error, { context: "test" });
        
        const { data } = await supabase
            .from("whatsapp_log")
            .select("*")
            .eq("status", "ERROR")
            .maybeSingle();
            
        assertEquals(data?.status, "ERROR");
    });
});

// Run: deno test --allow-all --allow-net tests/logger_test.ts
```

### 3. Message Processor Tests

File: `tests/message_processor_test.ts`

```typescript
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "@supabase/supabase-js";
import { 
    getOrCreateSession,
    updateSession
} from "../functions/shared/message-processor.ts";

const supabase = createClient(
    Deno.env.get("SB_URL")!,
    Deno.env.get("SB_SERVICE_ROLE_KEY")!
);

Deno.test("Message Processor", async (t) => {
    const testPhone = "919876543210";
    
    await t.step("Creates new session", async () => {
        // Clear any existing session
        await supabase
            .from("whatsapp_sessions")
            .delete()
            .eq("phone", testPhone);
        
        const session = await getOrCreateSession(supabase, testPhone);
        
        assertEquals(session.phone, testPhone);
        assertEquals(session.role, "PATIENT");
        assertEquals(session.state, "LANGUAGE_SELECT");
    });
    
    await t.step("Returns existing session", async () => {
        const session1 = await getOrCreateSession(supabase, testPhone);
        const session2 = await getOrCreateSession(supabase, testPhone);
        
        assertEquals(session1.id, session2.id);
    });
    
    await t.step("Updates session state", async () => {
        await updateSession(supabase, testPhone, {
            state: "MAIN_MENU",
            data: { language: "EN" }
        });
        
        const updated = await getOrCreateSession(supabase, testPhone);
        assertEquals(updated.state, "MAIN_MENU");
        assertEquals(updated.data.language, "EN");
    });
});

// Run: deno test --allow-all --allow-net tests/message_processor_test.ts
```

---

## Integration Tests

### Webhook Verification Test

File: `tests/webhook_verification_test.ts`

```typescript
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";

const WEBHOOK_URL = "http://localhost:54321/functions/v1/webhook";
const VERIFY_TOKEN = "test-token";

Deno.test("Webhook Verification", async (t) => {
    await t.step("Validates webhook token", async () => {
        const response = await fetch(
            `${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=TESTCHALLENGE123`
        );
        
        const text = await response.text();
        assertEquals(text, "TESTCHALLENGE123");
    });
    
    await t.step("Rejects invalid token", async () => {
        const response = await fetch(
            `${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=TEST123`
        );
        
        assertEquals(response.status, 403);
    });
});

// Run: deno test --allow-all --allow-net tests/webhook_verification_test.ts
```

### Message Processing Test

File: `tests/webhook_message_test.ts`

```typescript
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "@supabase/supabase-js";

const WEBHOOK_URL = "http://localhost:54321/functions/v1/webhook?token=test-post-token";
const supabase = createClient(
    "http://localhost:54321",
    Deno.env.get("SB_ANON_KEY")!
);

Deno.test("Webhook Message Processing", async (t) => {
    await t.step("Processes inbound text message", async () => {
        const payload = {
            entry: [{
                changes: [{
                    value: {
                        messages: [{
                            from: "919876543210",
                            id: "msg_" + Date.now(),
                            type: "text",
                            text: { body: "Hi" }
                        }],
                        contacts: [{
                            profile: { name: "Test User" }
                        }],
                        metadata: {
                            phone_number_id: "123456789"
                        }
                    }
                }]
            }]
        };
        
        const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        
        assertEquals(response.status, 200);
        
        // Verify message was logged
        const { data } = await supabase
            .from("whatsapp_log")
            .select("*")
            .eq("phone", "919876543210")
            .order("created_at", { ascending: false })
            .limit(1)
            .single();
        
        assertEquals(data?.message, "Hi");
    });
    
    await t.step("Creates session for new user", async () => {
        const phone = "919876543211";
        
        const payload = {
            entry: [{
                changes: [{
                    value: {
                        messages: [{
                            from: phone,
                            id: "msg_" + Date.now(),
                            type: "text",
                            text: { body: "Hello" }
                        }],
                        contacts: [{
                            profile: { name: "New User" }
                        }],
                        metadata: {
                            phone_number_id: "123456789"
                        }
                    }
                }]
            }]
        };
        
        await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        
        // Verify session was created
        const { data } = await supabase
            .from("whatsapp_sessions")
            .select("*")
            .eq("phone", phone)
            .single();
        
        assertEquals(data?.role, "PATIENT");
    });
});

// Run: deno test --allow-all --allow-net tests/webhook_message_test.ts
```

---

## End-to-End Flow Tests

### Patient Appointment Booking Flow

File: `tests/patient_booking_flow_test.ts`

```typescript
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createClient } from "@supabase/supabase-js";

const WEBHOOK_URL = "http://localhost:54321/functions/v1/webhook?token=test-post-token";
const supabase = createClient(
    "http://localhost:54321",
    Deno.env.get("SB_ANON_KEY")!
);

async function sendMessage(phone: string, text: string): Promise<void> {
    const payload = {
        entry: [{
            changes: [{
                value: {
                    messages: [{
                        from: phone,
                        id: "msg_" + Date.now() + "_" + Math.random(),
                        type: "text",
                        text: { body: text }
                    }],
                    contacts: [{
                        profile: { name: "Test User" }
                    }],
                    metadata: {
                        phone_number_id: "123456789"
                    }
                }
            }]
        }]
    };
    
    await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    
    // Give function time to process
    await new Promise(resolve => setTimeout(resolve, 500));
}

Deno.test("Patient Booking Flow", async (t) => {
    const testPhone = "919876543220";
    
    // Clear previous state
    await supabase
        .from("whatsapp_sessions")
        .delete()
        .eq("phone", testPhone);
    
    await t.step("Patient starts with greeting", async () => {
        await sendMessage(testPhone, "Hi");
        
        const session = await supabase
            .from("whatsapp_sessions")
            .select("*")
            .eq("phone", testPhone)
            .single();
        
        assertEquals(session.data?.state, "LANGUAGE_SELECT");
    });
    
    await t.step("Patient selects language", async () => {
        await sendMessage(testPhone, "1");  // English
        
        const session = await supabase
            .from("whatsapp_sessions")
            .select("*")
            .eq("phone", testPhone)
            .single();
        
        // TODO: Update state based on implementation
        // assertEquals(session.data?.state, "MAIN_MENU");
    });
    
    // TODO: Continue with other steps
    // - Select "Book Appointment"
    // - Select doctor
    // - Select date
    // - Select time
    // - Enter patient name
    // - Confirm booking
    // Verify appointment created in Google Sheets
});

// Run: deno test --allow-all --allow-net tests/patient_booking_flow_test.ts
```

---

## Performance Tests

### Latency Benchmark

File: `tests/performance_test.ts`

```typescript
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

const WEBHOOK_URL = "http://localhost:54321/functions/v1/webhook?token=test-post-token";

async function measureLatency(iterations: number = 100): Promise<{
    min: number,
    max: number,
    avg: number,
    p95: number
}> {
    const times: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
        const payload = {
            entry: [{
                changes: [{
                    value: {
                        messages: [{
                            from: "919876543210",
                            id: "perf_test_" + i,
                            type: "text",
                            text: { body: "test" }
                        }],
                        contacts: [{
                            profile: { name: "Perf Test" }
                        }],
                        metadata: {
                            phone_number_id: "123456789"
                        }
                    }
                }]
            }]
        };
        
        const start = performance.now();
        await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const duration = performance.now() - start;
        times.push(duration);
    }
    
    times.sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);
    
    return {
        min: times[0],
        max: times[times.length - 1],
        avg: sum / times.length,
        p95: times[Math.floor(times.length * 0.95)]
    };
}

Deno.test("Performance: Webhook Latency", async () => {
    const results = await measureLatency(100);
    
    console.log("Webhook Latency Results:");
    console.log(`  Min: ${results.min.toFixed(2)}ms`);
    console.log(`  Max: ${results.max.toFixed(2)}ms`);
    console.log(`  Avg: ${results.avg.toFixed(2)}ms`);
    console.log(`  P95: ${results.p95.toFixed(2)}ms`);
    
    // Assert performance targets
    assertEquals(results.avg < 2000, true, "Average latency should be < 2 seconds");
    assertEquals(results.p95 < 5000, true, "P95 latency should be < 5 seconds");
});

// Run: deno test --allow-all --allow-net tests/performance_test.ts
```

---

## Running All Tests

### Test Script

Create `tests/run_all.sh`:

```bash
#!/bin/bash

set -e

echo "Starting Supabase..."
supabase start

echo "Running unit tests..."
deno test --allow-all tests/validators_test.ts
deno test --allow-all --allow-net tests/logger_test.ts
deno test --allow-all --allow-net tests/message_processor_test.ts

echo "Running integration tests..."
deno test --allow-all --allow-net tests/webhook_verification_test.ts
deno test --allow-all --allow-net tests/webhook_message_test.ts

echo "Running E2E tests..."
deno test --allow-all --allow-net tests/patient_booking_flow_test.ts

echo "Running performance tests..."
deno test --allow-all --allow-net tests/performance_test.ts

echo "Stopping Supabase..."
supabase stop

echo "✅ All tests passed!"
```

Run with:
```bash
chmod +x tests/run_all.sh
./tests/run_all.sh
```

---

## Test Coverage

### Coverage Goals

- [ ] Unit tests: 80% coverage
- [ ] Integration tests: 100% happy path
- [ ] Edge cases: 100% coverage
- [ ] Error scenarios: 100% coverage
- [ ] Performance: All endpoints < 5s

### Generate Coverage Report

```bash
deno test --allow-all --coverage=coverage tests/
deno coverage coverage --lcov --output=coverage.lcov
```

---

## Continuous Integration

### GitHub Actions Workflow

Create `.github/workflows/test.yml`:

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - uses: denoland/setup-deno@v1
        with:
          deno-version: vx.x.x
      
      - name: Start Supabase
        run: |
          npm install -g supabase
          supabase start -x realtime,storage,pgbouncer
      
      - name: Run tests
        run: |
          deno test --allow-all --allow-net tests/
      
      - name: Generate coverage
        run: |
          deno test --allow-all --coverage=coverage tests/
          deno coverage coverage --lcov --output=coverage.lcov
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage.lcov
```

---

## Troubleshooting Tests

### Tests Timing Out

**Problem:** Tests fail with timeout error

**Solution:**
```bash
# Increase timeout
deno test --allow-all --allow-net --permissions-prompt tests/

# Or set in test:
const timeout = setTimeout(() => { throw new Error("Timeout"); }, 30000);
```

### Database Not Clean

**Problem:** Tests fail due to leftover data from previous runs

**Solution:**
```typescript
// Clean up before each test
beforeEach(async () => {
    await supabase.from("whatsapp_sessions").delete().neq("id", "");
    await supabase.from("whatsapp_log").delete().neq("id", "");
});
```

### Environment Variables Missing

**Problem:** Tests fail with "undefined environment variable"

**Solution:**
```bash
# Create .env.test file
export SB_URL=http://localhost:54321
export SB_ANON_KEY=eyJ...

# Source before running
source .env.test
deno test --allow-all --allow-net tests/
```

---

## Next Steps

1. ✅ Review testing strategy
2. → [Set up test environment](./SETUP.md)
3. → [Write unit tests](./tests/validators_test.ts)
4. → [Write integration tests](./tests/webhook_message_test.ts)
5. → [Set up CI/CD](../.github/workflows/test.yml)
