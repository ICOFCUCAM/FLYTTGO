import { beforeEach, describe, expect, it } from 'vitest';
import { clearBookingDraft, readBookingDraft, returnToBookingAfterSignIn, saveBookingDraft, takeReturnPage } from '../lib/bookingDraft';

/* A booking survives a Google or Apple sign-in round trip (lib/bookingDraft.ts). */
describe('booking draft across sign-in', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as any).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  it('keeps the booking and sends the callback back to it once', () => {
    saveBookingDraft({ step: 5, vanType: 'large_van', estimatedHours: 3 });
    returnToBookingAfterSignIn();
    expect(readBookingDraft()).toEqual({ step: 5, vanType: 'large_van', estimatedHours: 3 });
    expect(takeReturnPage()).toBe('booking');
    expect(takeReturnPage()).toBeNull();                 // read once
    expect(readBookingDraft()).not.toBeNull();           // the booking page still restores it
    clearBookingDraft();
    expect(readBookingDraft()).toBeNull();
  });

  it('drops a draft older than two hours, and does not return to an empty booking', () => {
    saveBookingDraft({ step: 2 });
    expect(readBookingDraft(Date.now() + 3 * 60 * 60 * 1000)).toBeNull();
    clearBookingDraft();
    returnToBookingAfterSignIn();
    expect(takeReturnPage()).toBeNull();
  });

  it('works when storage is blocked', () => {
    (globalThis as any).sessionStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(() => saveBookingDraft({ step: 1 })).not.toThrow();
    expect(readBookingDraft()).toBeNull();
    expect(takeReturnPage()).toBeNull();
  });
});
