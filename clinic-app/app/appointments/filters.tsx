"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export type StateFilter = "ALL" | "WAITING" | "SEEN";
export type PlaceFilter = "ALL" | "CLINIC" | "HOME";

/**
 * The filters live above both the toolbar that sets them and the table that
 * obeys them, which are siblings under a server component and so cannot pass
 * state between themselves.
 *
 * Held in React rather than the query string on purpose: changing a filter is
 * a glance, and a round trip to the server for each tab made the day flicker.
 */
const FilterContext = createContext<{
    state: StateFilter;
    setState: (value: StateFilter) => void;
    place: PlaceFilter;
    setPlace: (value: PlaceFilter) => void;
} | null>(null);

export function AppointmentFilters({ children }: { children: ReactNode }) {
    const [state, setState] = useState<StateFilter>("ALL");
    const [place, setPlace] = useState<PlaceFilter>("ALL");

    return (
        <FilterContext.Provider value={{ state, setState, place, setPlace }}>
            {children}
        </FilterContext.Provider>
    );
}

export function useAppointmentFilters() {
    const found = useContext(FilterContext);

    if (!found) {
        throw new Error("Appointment filters used outside AppointmentFilters");
    }

    return found;
}

export interface FilterCounts {
    all: number;
    waiting: number;
    seen: number;
    clinic: number;
    home: number;
}
