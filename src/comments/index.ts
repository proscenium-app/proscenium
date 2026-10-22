// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  COMMENT_NAME_MAX,
  anchorSpan,
  cleanCommentName,
  collectComments,
  commentNameInput,
  holdsCommentRange,
  isAnchorNoteText,
  isCommentOnlyBlock,
  joinsThread,
  nameSpan,
  noteText,
  parseCommentText,
  rangeMarker,
  signComment,
  type CommentEntry,
  type ParsedComment,
} from "./model";
export {
  COMMENT_RANGE,
  COMMENT_RANGE_END,
  dropRangeMarkers,
  liveRangeIds,
  rangesFromEditor,
  rangesToEditor,
} from "./ranges";
export {
  Comments,
  collectPmComments,
  commentJumpTarget,
  commentThreads,
  commentsState,
  type CommentThread,
  type CommentsStorage,
  type PmCommentEntry,
} from "./plugin";
export { stackCards, type CardBox } from "./stack";
export { CommentsFeed } from "./CommentsFeed";
export { CommentsMargin, type MarginState } from "./CommentsMargin";
