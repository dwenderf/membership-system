-- Enable RLS on user_survey_responses table
ALTER TABLE public.user_survey_responses ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own survey responses
CREATE POLICY "Users can read own survey responses" ON public.user_survey_responses
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own survey responses
CREATE POLICY "Users can insert own survey responses" ON public.user_survey_responses
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users cannot update survey responses (responses are immutable)
-- No update policy needed - responses should not be changed after submission

-- Policy: Users cannot delete survey responses
-- No delete policy needed - responses should be permanent for audit trail