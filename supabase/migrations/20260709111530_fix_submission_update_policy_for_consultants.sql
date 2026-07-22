-- Drop the existing update policy
DROP POLICY IF EXISTS update_submissions ON assignment_submissions;

-- Create new update policy that allows both participants (for their own) and consultants (for reviews)
CREATE POLICY "update_submissions" ON assignment_submissions FOR UPDATE
  TO authenticated
  USING (
    -- Participant can update their own submission
    participant_id = auth_participant_id()
    OR
    -- Consultant can update submissions for assignments in their companies (to add reviews)
    assignment_id IN (
      SELECT a.id FROM assignments a
      JOIN companies c ON c.id = a.company_id
      WHERE c.consultant_id = auth_consultant_id()
    )
  )
  WITH CHECK (
    -- Same conditions for the new values
    participant_id = auth_participant_id()
    OR
    assignment_id IN (
      SELECT a.id FROM assignments a
      JOIN companies c ON c.id = a.company_id
      WHERE c.consultant_id = auth_consultant_id()
    )
  );