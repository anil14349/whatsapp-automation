# API Integration Guide - ABC Clinic WhatsApp Automation

## Quick Start

### 1. Initialize API Client

```typescript
// types/api.ts
export interface ApiClient {
  baseUrl: string;
  token?: string;
  
  // Auth methods
  loginDoctor(email: string, pin: string, clinicId: string): Promise<AuthResponse>;
  loginReceptionist(email: string, password: string, clinicId: string): Promise<AuthResponse>;
  getProfile(): Promise<DoctorProfile | ReceptionistProfile>;
  logout(): void;
  
  // Appointment methods
  listAppointments(date?: string, status?: string): Promise<AppointmentsResponse>;
  createAppointment(data: CreateAppointmentRequest): Promise<AppointmentResponse>;
  updateAppointmentStatus(appointmentId: string, status: string, notes?: string): Promise<AppointmentResponse>;
}

// auth.ts
export class ApiAuthClient {
  private baseUrl: string;
  private token?: string;
  
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    // Load token from localStorage if exists
    this.token = localStorage.getItem("api_token") || undefined;
  }
  
  async loginDoctor(email: string, pin: string, clinicId: string) {
    const response = await fetch(`${this.baseUrl}/doctors/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, pin, clinicId })
    });
    
    if (!response.ok) {
      throw new Error(`Login failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    this.setToken(data.token);
    return data;
  }
  
  async loginReceptionist(email: string, password: string, clinicId: string) {
    const response = await fetch(`${this.baseUrl}/receptionists/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, clinicId })
    });
    
    if (!response.ok) {
      throw new Error(`Login failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    this.setToken(data.token);
    return data;
  }
  
  async getProfile() {
    const response = await this.request("GET", "/doctors/auth/me");
    return response.json();
  }
  
  private setToken(token: string) {
    this.token = token;
    localStorage.setItem("api_token", token);
  }
  
  logout() {
    this.token = undefined;
    localStorage.removeItem("api_token");
  }
  
  private async request(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    
    if (response.status === 401) {
      // Token expired, clear it
      this.logout();
      window.location.href = "/login";
    }
    
    return response;
  }
}
```

### 2. React Hook Example

```typescript
// hooks/useApi.ts
import { useState, useCallback } from "react";
import { ApiAuthClient } from "../auth";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  "https://your-supabase-url/functions/v1/api";

export function useApi() {
  const [client] = useState(() => new ApiAuthClient(API_BASE_URL));
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const loginDoctor = useCallback(async (email: string, pin: string, clinicId: string) => {
    try {
      setLoading(true);
      setError(null);
      const result = await client.loginDoctor(email, pin, clinicId);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [client]);
  
  const loginReceptionist = useCallback(async (email: string, password: string, clinicId: string) => {
    try {
      setLoading(true);
      setError(null);
      const result = await client.loginReceptionist(email, password, clinicId);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [client]);
  
  return {
    loading,
    error,
    loginDoctor,
    loginReceptionist,
    client
  };
}

// Usage in component
export function DoctorLoginForm() {
  const { loading, error, loginDoctor } = useApi();
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [clinicId, setClinicId] = useState("");
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await loginDoctor(email, pin, clinicId);
      // Navigate to dashboard
      window.location.href = "/doctor/dashboard";
    } catch (err) {
      // Error shown in loading/error state
    }
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <input 
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        required
      />
      <input 
        type="password"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        placeholder="PIN"
        required
      />
      <input 
        type="text"
        value={clinicId}
        onChange={(e) => setClinicId(e.target.value)}
        placeholder="Clinic ID"
        required
      />
      <button type="submit" disabled={loading}>
        {loading ? "Logging in..." : "Login"}
      </button>
      {error && <div className="error">{error}</div>}
    </form>
  );
}
```

### 3. Vue.js Example

```vue
<template>
  <div class="login-form">
    <form @submit.prevent="handleLogin">
      <input 
        v-model="email" 
        type="email" 
        placeholder="Email"
        required
      />
      <input 
        v-model="pin" 
        type="password" 
        placeholder="PIN"
        required
      />
      <input 
        v-model="clinicId" 
        type="text" 
        placeholder="Clinic ID"
        required
      />
      <button type="submit" :disabled="loading">
        {{ loading ? "Logging in..." : "Login" }}
      </button>
      <div v-if="error" class="error">{{ error }}</div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { ApiAuthClient } from "@/api/auth";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const client = new ApiAuthClient(API_BASE_URL);

const email = ref("");
const pin = ref("");
const clinicId = ref("");
const loading = ref(false);
const error = ref("");

async function handleLogin() {
  try {
    loading.value = true;
    error.value = "";
    
    await client.loginDoctor(email.value, pin.value, clinicId.value);
    
    // Navigate to dashboard
    window.location.href = "/doctor/dashboard";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Login failed";
  } finally {
    loading.value = false;
  }
}
</script>
```

### 4. Next.js Example (with TypeScript)

```typescript
// app/doctor/login/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiAuthClient } from "@/lib/api/auth";

export default function DoctorLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  const client = new ApiAuthClient(process.env.NEXT_PUBLIC_API_BASE_URL || "");
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      setLoading(true);
      setError("");
      
      const result = await client.loginDoctor(email, pin, clinicId);
      
      // Save doctor info to context/state if needed
      sessionStorage.setItem("doctor", JSON.stringify(result.doctor));
      
      // Redirect to dashboard
      router.push("/doctor/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold mb-6">Doctor Login</h1>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input 
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700">PIN</label>
            <input 
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700">Clinic ID</label>
            <input 
              type="text"
              value={clinicId}
              onChange={(e) => setClinicId(e.target.value)}
              className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
              {error}
            </div>
          )}
          
          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

### 5. Appointments Dashboard

```typescript
// components/DoctorAppointments.tsx
import { useEffect, useState } from "react";
import { ApiAuthClient } from "@/lib/api/auth";

interface Appointment {
  id: string;
  date: string;
  time: string;
  status: string;
  patient: { id: string; name: string; phone: string };
  doctor: { id: string; name: string };
  notes: string;
  completedAt: string | null;
}

export function DoctorAppointments() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  
  const client = new ApiAuthClient(process.env.NEXT_PUBLIC_API_BASE_URL || "");
  
  useEffect(() => {
    async function fetchAppointments() {
      try {
        setLoading(true);
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL}/doctors/appointments?date=${selectedDate}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("api_token")}`
            }
          }
        );
        
        if (!response.ok) throw new Error("Failed to fetch appointments");
        
        const data = await response.json();
        setAppointments(data.appointments);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error fetching appointments");
      } finally {
        setLoading(false);
      }
    }
    
    fetchAppointments();
  }, [selectedDate]);
  
  const handleMarkComplete = async (appointmentId: string) => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/doctors/appointments/${appointmentId}/status`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("api_token")}`
          },
          body: JSON.stringify({ status: "COMPLETED" })
        }
      );
      
      if (!response.ok) throw new Error("Failed to update appointment");
      
      // Refresh appointments
      setAppointments(apps => 
        apps.map(a => a.id === appointmentId ? {...a, status: "COMPLETED"} : a)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error updating appointment");
    }
  };
  
  if (loading) return <div>Loading appointments...</div>;
  
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium">Date</label>
        <input 
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="mt-1 px-4 py-2 border border-gray-300 rounded-md"
        />
      </div>
      
      {error && <div className="bg-red-50 p-4 text-red-700 rounded-md">{error}</div>}
      
      <div className="space-y-2">
        {appointments.map(apt => (
          <div key={apt.id} className="border border-gray-200 rounded-lg p-4">
            <div className="flex justify-between">
              <div>
                <h3 className="font-semibold">{apt.patient.name}</h3>
                <p className="text-sm text-gray-600">{apt.time} - Dr. {apt.doctor.name}</p>
                <p className="text-sm text-gray-500">{apt.notes}</p>
              </div>
              <div>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  apt.status === "COMPLETED" ? "bg-green-100 text-green-800" :
                  apt.status === "CONFIRMED" ? "bg-blue-100 text-blue-800" :
                  "bg-gray-100 text-gray-800"
                }`}>
                  {apt.status}
                </span>
              </div>
            </div>
            
            {apt.status === "CONFIRMED" && (
              <button 
                onClick={() => handleMarkComplete(apt.id)}
                className="mt-2 text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
              >
                Mark Complete
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Error Handling

### Recommended Error Handler

```typescript
// utils/api-errors.ts
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function handleApiError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.statusCode) {
      case 400:
        return `Validation error: ${error.message}`;
      case 401:
        return "Session expired. Please login again.";
      case 403:
        return "You don't have permission to access this resource.";
      case 404:
        return "Resource not found.";
      case 500:
        return "Server error. Please try again later.";
      default:
        return error.message;
    }
  }
  return "An unexpected error occurred.";
}
```

---

## Environment Variables

Create `.env.local` in your frontend project:

```env
NEXT_PUBLIC_API_BASE_URL=https://your-supabase-url/functions/v1/api
VITE_API_BASE_URL=https://your-supabase-url/functions/v1/api
```

---

## Testing with cURL

See API_DOCUMENTATION.md for detailed cURL examples.

---

## Next Steps

- [ ] Implement Admin APIs
- [ ] Add comprehensive error handling
- [ ] Implement token refresh logic
- [ ] Add loading states and optimistic updates
- [ ] Implement caching strategy
- [ ] Add request retry logic
- [ ] Set up API monitoring
- [ ] Create comprehensive test suite
