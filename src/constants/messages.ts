export const MESSAGES = {
  // auth messages
  REGISTER_SUCCESS: 'Register success',
  REGISTER_SUCCESS_WITH_VERIFY_EMAIL: 'Register success, please check your email to verify your account',
  LOGIN_SUCCESS: 'Login success',
  LOGOUT_SUCCESS: 'Logout success',
  UNAUTHORIZED: 'Unauthorized',
  USER_NOT_VERIFIED: 'User not verified',
  EMAIL_ALREADY_EXISTS: 'Email already exists',
  EMAIL_DOES_NOT_EXIST: 'Email does not exist',
  USER_DOES_NOT_EXIST: 'Email does not exist or password is incorrect',
  USER_NOT_FOUND: 'User not found',
  INVALID_PASSWORD: 'Invalid password',
  USER_ALREADY_VERIFIED: 'User already verified',
  EMAIL_ALREADY_VERIFIED: 'Email already verified',
  FORGOT_PASSWORD_TOKEN_INVALID: 'Forgot password token is invalid',

  // success messages
  PASSWORD_RESET_SUCCESS: 'Password reset success',
  FORGOT_PASSWORD_SUCCESS: 'Forgot password success, please check your email to reset your password',
  RESEND_VERIFY_EMAIL_SUCCESS: 'Resend verify email success',
  VERIFY_EMAIL_SUCCESS: 'Verify email success',
  REFRESH_TOKEN_SUCCESS: 'Refresh token success',
  GET_USER_PROFILE_SUCCESS: 'Get user profile success',
  FOLLOW_USER_SUCCESS: 'Follow user success',
  UNFOLLOW_USER_SUCCESS: 'Unfollow user success',
  CHANGE_PASSWORD_SUCCESS: 'Change password success',
  RESET_PASSWORD_SUCCESS: 'Reset password success',
  RESEND_EMAIL_VERIFY_SUCCESS: 'Resend email verify success',
  GET_USER_INFO_SUCCESS: 'Get user info success',
  UPDATE_USER_INFO_SUCCESS: 'Update user info success',
  UPLOAD_VIDEO_SUCCESS: 'Upload video success',
  UPLOAD_IMAGE_SUCCESS: 'Upload image success',
  FOLLOWED: 'Followed',
  UNFOLLOWED: 'Unfollowed',
  CHECK_EMAIL_TO_RESET_PASSWORD: 'Check your email to reset password',
  EMAIL_SENT_SUCCESS: 'Email sent successfully',

  // token messages
  TOKEN_IS_REQUIRED: 'Token is required',
  TOKEN_INVALID_FORMAT: 'Invalid token format',
  TOKEN_MUST_BE_STRING: 'Token must be a string',
  INVALID_TOKEN_FORMAT: 'Invalid token format. Must be: Bearer <token>',
  ACCESS_TOKEN_IS_REQUIRED: 'Access token is required',
  REFRESH_TOKEN_IS_REQUIRED: 'Refresh token is required',
  USED_REFRESH_TOKEN_OR_NOT_EXIST: 'Used refresh token or not exist',
  INVALID_REFRESH_TOKEN: 'Invalid refresh token',
  TOKEN_EXPIRED: 'Token expired',
  JWT_SIGN_FAILED: 'JWT sign failed',
  INVALID_TOKEN_PAYLOAD: 'Invalid token payload',
  EMAIL_VERIFY_TOKEN_IS_REQUIRED: 'Email verify token is required',
  EMAIL_VERIFY_SUCCESS: 'Email verify success',
  EMAIL_ALREADY_VERIFIED_BEFORE: 'Email already verified before',
  GMAIL_NOT_VERIFIED: 'Gmail not verified',
  INVALID_TOKEN: 'Invalid token',
  REFRESH_TOKEN_INVALID_OR_REVOKED: 'Refresh token is invalid or revoked',
  VERIFY_FORGOT_PASSWORD_TOKEN_SUCCESS: 'Verify forgot password token success',

  // user messages
  BIO_MUST_BE_STRING: 'Bio must be a string',
  BIO_LENGTH_MUST_BE_FROM_1_TO_1000: 'Bio length must be between 1 and 1000 characters',
  USERNAME_MUST_BE_STRING: 'Username must be a string',
  USERNAME_LENGTH_MUST_BE_FROM_1_TO_100: 'Username length must be between 1 and 100 characters',
  USERNAME_ALREADY_EXISTS: 'Username already exists',
  USERNAME_MUST_BE_ALPHANUMERIC: 'Username must be alphanumeric and can contain underscores and dots only',

  AVATAR_MUST_BE_URL: 'Avatar must be a valid URL',
  COVER_PHOTO_MUST_BE_URL: 'Cover photo must be a valid URL',

  WEBSITE_MUST_BE_URL: 'Website must be a valid URL',

  LOCATION_MUST_BE_STRING: 'Location must be a string',
  LOCATION_LENGTH_MUST_BE_FROM_1_TO_100: 'Location length must be between 1 and 100 characters',

  OLD_PASSWORD_IS_INCORRECT: 'Old password is incorrect',
  OLD_PASSWORD_MUST_BE_STRING: 'Old password must be a string',
  OLD_PASSWORD_IS_REQUIRED: 'Old password is required',

  // validation messages
  VALIDATION_ERROR: 'Validation error',

  // Name
  NAME_IS_REQUIRED: 'Name is required',
  NAME_MUST_BE_STRING: 'Name must be a string',
  NAME_LENGTH_MUST_BE_FROM_1_TO_100: 'Name length must be between 1 and 100 characters',

  // Email
  EMAIL_IS_REQUIRED: 'Email is required',
  EMAIL_MUST_BE_VALID: 'Incorrect email format',

  // Password
  PASSWORD_IS_REQUIRED: 'Password is required',
  PASSWORD_MUST_BE_STRING: 'Password must be a string',
  PASSWORD_MUST_BE_STRONG:
    'Password must be at least 6 characters and must contain at least 1 uppercase letter, 1 lowercase letter, 1 number and 1 character',

  // Confirm password
  CONFIRM_PASSWORD_IS_REQUIRED: 'Confirm password is required',
  CONFIRM_PASSWORD_MUST_BE_STRING: 'Confirm password must be a string',
  CONFIRM_PASSWORD_LENGTH: 'Confirm password must be between 6 and 50 characters',
  CONFIRM_PASSWORD_MUST_BE_STRONG:
    'Confirm password must be at least 6 characters and must contain at least 1 uppercase letter, 1 lowercase letter, 1 number and 1 character',
  CONFIRM_PASSWORD_DOES_NOT_MATCH: 'Password confirmation does not match password',

  FORGOT_PASSWORD_TOKEN_IS_REQUIRED: 'Forgot password token is required',
  INVALID_FORGOT_PASSWORD_TOKEN: 'Invalid forgot password token',
  // Date of birth
  DATE_OF_BIRTH_MUST_BE_YYYY_MM_DD: 'Date of birth must be in YYYY-MM-DD format'
}
