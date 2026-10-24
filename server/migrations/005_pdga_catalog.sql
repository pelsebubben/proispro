-- Only provider IDs and private bag relationships persist; PDGA content is fetched on demand.
ALTER TABLE course_pins ADD CONSTRAINT pdga_pin_id_only CHECK (
  course_id IS NULL OR course_id NOT LIKE 'pdga:%' OR
  (course_id ~ '^pdga:[1-9][0-9]{0,15}$' AND course_name = 'PDGA course')
);
