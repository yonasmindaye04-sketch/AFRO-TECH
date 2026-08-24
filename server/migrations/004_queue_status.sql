-- Queue flow needs the 'in_service' status on appointments
ALTER TABLE appointments DROP CONSTRAINT appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('scheduled', 'in_service', 'completed', 'cancelled', 'no_show'));
