export type ParticipantRole = 'leadership' | 'management' | 'participant';

export type UserRole = 'consultant' | 'participant';

export type SubmissionStatus = 'draft' | 'submitted' | 'reviewed' | 'approved' | 'changes_requested';

export type NotificationType = 'new_assignment' | 'submission_received' | 'feedback_received' | 'meeting_scheduled' | 'media_uploaded';

export type QuestionType = 'short_text' | 'long_text' | 'multiple_choice' | 'checkboxes' | 'file_upload';

export interface Consultant {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  status: string | null;
  vibe_emoji: string | null;
  created_at: string;
}

export interface Company {
  id: string;
  consultant_id: string;
  name: string;
  industry: string | null;
  description: string | null;
  created_at: string;
}

export interface Participant {
  id: string;
  user_id: string | null;
  company_id: string;
  full_name: string;
  email: string;
  role: ParticipantRole;
  avatar_url: string | null;
  status: string | null;
  vibe_emoji: string | null;
  created_at: string;
}

export interface Assignment {
  id: string;
  company_id: string;
  title: string;
  description: string;
  due_date: string | null;
  created_at: string;
}

export interface AssignmentQuestion {
  id: string;
  assignment_id: string;
  order_index: number;
  question_type: QuestionType;
  question_text: string;
  options: string[] | null;
  required: boolean;
  created_at: string;
}

export interface AssignmentRecipient {
  id: string;
  assignment_id: string;
  participant_id: string;
  created_at: string;
}

export interface AssignmentSubmission {
  id: string;
  assignment_id: string;
  participant_id: string;
  content: string;
  submitted_at: string;
  status: SubmissionStatus;
  consultant_feedback: string | null;
  reviewed_at: string | null;
  has_files: boolean;
}

export interface AssignmentAnswer {
  id: string;
  submission_id: string;
  question_id: string;
  answer_text: string | null;
  answer_choices: string[] | null;
  file_path: string | null;
  file_name: string | null;
  created_at: string;
}

export interface Meeting {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  duration_minutes: number;
  location: string | null;
  created_at: string;
}

export interface Feedback {
  id: string;
  participant_id: string;
  assignment_id: string | null;
  meeting_id: string | null;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
  consultantId?: string;
  participantId?: string;
  avatarUrl?: string | null;
  status?: string | null;
  vibeEmoji?: string | null;
}

// The 7 "coaching vibe" emojis — used for profile emoji + post reactions.
export const VIBE_EMOJIS = ['💪', '🔥', '🎯', '🌱', '🙌', '💡', '⭐'] as const;

export type MediaVisibility = 'public' | 'private' | 'coach_only';

export interface MediaItem {
  id: string;
  company_id: string;
  participant_id: string | null;
  uploaded_by: string;
  file_name: string;
  storage_path: string;
  file_size: number;
  mime_type: string | null;
  visibility: MediaVisibility;
  created_at: string;
}

export interface ForumTopic {
  id: string;
  company_id: string;
  created_by: string;
  title: string;
  description: string | null;
  is_locked: boolean;
  created_at: string;
}

export interface ForumPost {
  id: string;
  topic_id: string;
  company_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface ForumComment {
  id: string;
  post_id: string;
  company_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface ForumReaction {
  id: string;
  post_id: string;
  company_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

/** Display info for whoever wrote a post/comment. */
export interface ForumPerson {
  userId: string;
  name: string;
  avatarUrl: string | null;
  vibeEmoji: string | null;
  isCoach: boolean;
}
