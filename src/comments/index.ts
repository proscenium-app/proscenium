// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  anchorSpan,
  collectComments,
  isAnchorNoteText,
  isCommentOnlyBlock,
  noteText,
  parseCommentText,
  type CommentEntry,
  type ParsedComment,
} from "./model";
export {
  Comments,
  collectPmComments,
  commentJumpTarget,
  commentsState,
  type CommentsStorage,
  type PmCommentEntry,
} from "./plugin";
export { stackCards, type CardBox } from "./stack";
export { CommentsFeed } from "./CommentsFeed";
export { CommentsMargin, type MarginState } from "./CommentsMargin";
