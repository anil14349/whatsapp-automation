# Branded Components - Usage Guide

Complete guide to using the branded component library throughout the admin dashboard.

---

## Components Overview

### 1. BrandedButton

**Usage:**
```tsx
import { BrandedButton } from "@/app/admin/(dashboard)/components/branded";

<BrandedButton variant="primary" size="md">
  Save Changes
</BrandedButton>
```

**Props:**
```typescript
interface BrandedButtonProps {
  variant?: "primary" | "secondary" | "danger" | "success"; // default: primary
  size?: "sm" | "md" | "lg"; // default: md
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}
```

**Variants:**
- `primary` - Uses clinic's primary color
- `secondary` - Uses clinic's secondary color
- `danger` - Red (destructive actions)
- `success` - Green (positive actions)

---

### 2. BrandedInput

**Usage:**
```tsx
import { BrandedInput } from "@/app/admin/(dashboard)/components/branded";

<BrandedInput
  label="Email Address"
  type="email"
  placeholder="user@example.com"
  error={errors.email}
  helperText="We'll never share your email"
  onChange={(e) => setEmail(e.target.value)}
/>
```

**Props:**
```typescript
interface BrandedInputProps {
  label?: string;
  error?: string;
  helperText?: string;
  [HTML input attributes]
}
```

**Features:**
- Focus border uses primary color
- Error state in red
- Helper text support
- All standard input attributes

---

### 3. BrandedLink

**Usage:**
```tsx
import { BrandedLink } from "@/app/admin/(dashboard)/components/branded";

<BrandedLink href="/admin/doctors">
  View All Doctors
</BrandedLink>

<BrandedLink href="https://example.com" external>
  Visit Website
</BrandedLink>
```

**Props:**
```typescript
interface BrandedLinkProps {
  href: string;
  external?: boolean; // Opens in new tab
  children: React.ReactNode;
  [HTML anchor attributes]
}
```

---

### 4. BrandedBadge

**Usage:**
```tsx
import { BrandedBadge } from "@/app/admin/(dashboard)/components/branded";

<BrandedBadge variant="success">Confirmed</BrandedBadge>
<BrandedBadge variant="warning">Pending</BrandedBadge>
<BrandedBadge variant="danger">Cancelled</BrandedBadge>
```

**Props:**
```typescript
interface BrandedBadgeProps {
  variant?: "default" | "success" | "warning" | "danger" | "info"; // default: default
  size?: "sm" | "md"; // default: md
  children: React.ReactNode;
}
```

**Variants:**
- `default` - Uses accent color
- `success` - Green
- `warning` - Orange
- `danger` - Red
- `info` - Blue

---

### 5. BrandedCard

**Usage:**
```tsx
import { BrandedCard } from "@/app/admin/(dashboard)/components/branded";

<BrandedCard title="Appointment Details" headerColor>
  <div>
    <p>Date: September 10, 2026</p>
    <p>Time: 2:00 PM</p>
  </div>
</BrandedCard>
```

**Props:**
```typescript
interface BrandedCardProps {
  title?: string;
  headerColor?: boolean; // Adds colored top border
  children: React.ReactNode;
  className?: string;
}
```

---

### 6. BrandedTable

**Usage:**
```tsx
import {
  BrandedTable,
  BrandedTableHeader,
  BrandedTableRow,
  BrandedTableCell
} from "@/app/admin/(dashboard)/components/branded";

<BrandedTable>
  <BrandedTableHeader>
    <BrandedTableCell>Name</BrandedTableCell>
    <BrandedTableCell>Email</BrandedTableCell>
    <BrandedTableCell>Actions</BrandedTableCell>
  </BrandedTableHeader>
  <tbody>
    {users.map(user => (
      <BrandedTableRow key={user.id} onClick={() => selectUser(user)}>
        <BrandedTableCell>{user.name}</BrandedTableCell>
        <BrandedTableCell>{user.email}</BrandedTableCell>
        <BrandedTableCell>
          <BrandedButton size="sm">Edit</BrandedButton>
        </BrandedTableCell>
      </BrandedTableRow>
    ))}
  </tbody>
</BrandedTable>
```

**Components:**
- `BrandedTable` - Container
- `BrandedTableHeader` - Header row (with brand background)
- `BrandedTableRow` - Data row (clickable, hover effects)
- `BrandedTableCell` - Table cell

---

### 7. BrandedSelect

**Usage:**
```tsx
import { BrandedSelect } from "@/app/admin/(dashboard)/components/branded";

<BrandedSelect
  label="Doctor"
  options={[
    { value: "1", label: "Dr. Smith" },
    { value: "2", label: "Dr. Jones" }
  ]}
  onChange={(e) => setDoctorId(e.target.value)}
  error={errors.doctor}
/>
```

**Props:**
```typescript
interface BrandedSelectProps {
  label?: string;
  error?: string;
  options: Array<{ value: string | number; label: string }>;
  [HTML select attributes]
}
```

---

### 8. BrandedTextarea

**Usage:**
```tsx
import { BrandedTextarea } from "@/app/admin/(dashboard)/components/branded";

<BrandedTextarea
  label="Notes"
  placeholder="Enter additional notes..."
  rows={4}
  helperText="Max 500 characters"
  onChange={(e) => setNotes(e.target.value)}
/>
```

**Props:**
```typescript
interface BrandedTextareaProps {
  label?: string;
  error?: string;
  helperText?: string;
  [HTML textarea attributes]
}
```

---

### 9. BrandedModal

**Usage:**
```tsx
import { BrandedModal, BrandedButton } from "@/app/admin/(dashboard)/components/branded";

<BrandedModal
  isOpen={showModal}
  onClose={() => setShowModal(false)}
  title="Delete Appointment"
  size="md"
  actions={
    <>
      <BrandedButton
        variant="danger"
        onClick={() => deleteAppointment()}
      >
        Delete
      </BrandedButton>
      <BrandedButton
        variant="secondary"
        onClick={() => setShowModal(false)}
      >
        Cancel
      </BrandedButton>
    </>
  }
>
  <p>Are you sure you want to delete this appointment?</p>
  <p className="text-sm text-slate-500 mt-2">This action cannot be undone.</p>
</BrandedModal>
```

**Props:**
```typescript
interface BrandedModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode; // Buttons at bottom
  size?: "sm" | "md" | "lg"; // default: md
}
```

---

## Usage Patterns

### Pattern 1: Form with Branded Inputs

```tsx
"use client";
import { BrandedInput, BrandedSelect, BrandedButton } from "@/app/admin/(dashboard)/components/branded";
import { useState } from "react";

export function AppointmentForm() {
  const [formData, setFormData] = useState({
    patientName: "",
    doctorId: "",
    date: ""
  });
  const [errors, setErrors] = useState({});

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      // Submit logic
    }}>
      <BrandedInput
        label="Patient Name"
        value={formData.patientName}
        onChange={(e) => setFormData({...formData, patientName: e.target.value})}
        error={errors.patientName}
      />

      <BrandedSelect
        label="Doctor"
        options={[...]}
        value={formData.doctorId}
        onChange={(e) => setFormData({...formData, doctorId: e.target.value})}
      />

      <BrandedInput
        label="Date"
        type="date"
        value={formData.date}
        onChange={(e) => setFormData({...formData, date: e.target.value})}
      />

      <BrandedButton type="submit">Create Appointment</BrandedButton>
    </form>
  );
}
```

### Pattern 2: Table with Actions

```tsx
import { BrandedTable, BrandedTableHeader, BrandedTableRow, BrandedTableCell, BrandedButton, BrandedBadge } from "@/app/admin/(dashboard)/components/branded";

export function DoctorsList({ doctors }) {
  return (
    <BrandedTable>
      <BrandedTableHeader>
        <BrandedTableCell>Name</BrandedTableCell>
        <BrandedTableCell>Specialty</BrandedTableCell>
        <BrandedTableCell>Status</BrandedTableCell>
        <BrandedTableCell>Actions</BrandedTableCell>
      </BrandedTableHeader>
      <tbody>
        {doctors.map(doctor => (
          <BrandedTableRow key={doctor.id}>
            <BrandedTableCell>{doctor.name}</BrandedTableCell>
            <BrandedTableCell>{doctor.specialty}</BrandedTableCell>
            <BrandedTableCell>
              <BrandedBadge variant={doctor.active ? "success" : "warning"}>
                {doctor.active ? "Active" : "Inactive"}
              </BrandedBadge>
            </BrandedTableCell>
            <BrandedTableCell>
              <BrandedButton size="sm" variant="primary">Edit</BrandedButton>
            </BrandedTableCell>
          </BrandedTableRow>
        ))}
      </tbody>
    </BrandedTable>
  );
}
```

### Pattern 3: Card Layout

```tsx
import { BrandedCard, BrandedButton } from "@/app/admin/(dashboard)/components/branded";

export function AppointmentCard({ appointment }) {
  return (
    <BrandedCard title={appointment.patientName} headerColor>
      <div className="space-y-2">
        <p><strong>Doctor:</strong> {appointment.doctorName}</p>
        <p><strong>Date:</strong> {appointment.date}</p>
        <p><strong>Time:</strong> {appointment.time}</p>
      </div>
      <div className="mt-4 flex gap-2">
        <BrandedButton size="sm">Edit</BrandedButton>
        <BrandedButton size="sm" variant="danger">Cancel</BrandedButton>
      </div>
    </BrandedCard>
  );
}
```

---

## Migration Guide

### From Old to Branded Components

**Before:**
```tsx
<button className="bg-blue-600 px-4 py-2 text-white rounded-md hover:bg-blue-700">
  Save
</button>
```

**After:**
```tsx
<BrandedButton variant="primary">Save</BrandedButton>
```

**Benefits:**
- Automatically uses clinic's brand color
- Consistent styling across app
- Easier to maintain
- Better accessibility
- Automatic hover states

---

## Best Practices

1. **Always use BrandedButton** instead of plain `<button>` tags
2. **Use variant prop** for different button types (danger, success, etc.)
3. **Add labels to inputs** for accessibility
4. **Use error states** for form validation
5. **Use BrandedCard** to group related content
6. **Use BrandedTable** for lists and data
7. **Use BrandedBadge** for status indicators
8. **Use BrandedLink** for all navigation

---

## Customization

All components accept standard HTML attributes:

```tsx
// BrandedInput accepts all input attributes
<BrandedInput
  label="Email"
  type="email"
  required
  maxLength={100}
  placeholder="your@email.com"
/>

// BrandedButton accepts all button attributes
<BrandedButton
  type="submit"
  disabled={loading}
  aria-label="Submit form"
>
  Submit
</BrandedButton>
```

---

## Import Strategy

```tsx
// Import all at once
import {
  BrandedButton,
  BrandedInput,
  BrandedLink,
  BrandedBadge,
  BrandedCard,
  BrandedTable,
  BrandedTableHeader,
  BrandedTableRow,
  BrandedTableCell,
  BrandedSelect,
  BrandedTextarea,
  BrandedModal
} from "@/app/admin/(dashboard)/components/branded";

// Or import as needed
import { BrandedButton } from "@/app/admin/(dashboard)/components/branded";
```

---

## Summary

These 9 branded components provide:
- ✅ Consistent branding across the app
- ✅ Automatic clinic color usage
- ✅ Proper accessibility
- ✅ Standard styling patterns
- ✅ Easy maintenance
- ✅ Type-safe props

Use these components everywhere in the admin dashboard instead of plain HTML elements.

---

**Last Updated:** September 10, 2026  
**Version:** 1.0
