-- Optional physical calibration for a configured Windows printer. These values
-- default to zero and never alter invoice, payment, inventory, or print history.
alter table printers add column if not exists horizontal_offset_mm numeric(3,1) not null default 0;
alter table printers add column if not exists vertical_offset_mm numeric(3,1) not null default 0;
