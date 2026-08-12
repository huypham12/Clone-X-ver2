import { ObjectId } from 'mongodb'

export const getParentTweetLookupStages = (current_user_id?: string | null, prefix: string = '') => {
  const p = prefix ? `${prefix}.` : ''
  const stages: any[] = [
    {
      $lookup: {
        from: 'tweets',
        localField: `${p}parent_id`,
        foreignField: '_id',
        as: `${p}parent_tweet`
      }
    },
    {
      $unwind: {
        path: `$${p}parent_tweet`,
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $lookup: {
        from: 'users',
        localField: `${p}parent_tweet.user_id`,
        foreignField: '_id',
        as: `${p}parent_tweet.author`
      }
    },
    {
      $unwind: {
        path: `$${p}parent_tweet.author`,
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $lookup: {
        from: 'medias',
        localField: `${p}parent_tweet.medias`,
        foreignField: '_id',
        as: `${p}parent_tweet.medias_info`
      }
    },
    {
      $project: {
        [`${p}parent_tweet.author.password`]: 0,
        [`${p}parent_tweet.author.email_verify_token`]: 0,
        [`${p}parent_tweet.author.forgot_password_token`]: 0
      }
    }
  ]

  if (current_user_id) {
    stages.push(
      {
        $lookup: {
          from: 'bookmarks',
          let: { tweet_id: `$${p}parent_tweet._id` },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$tweet_id', '$$tweet_id'] }, { $eq: ['$user_id', new ObjectId(current_user_id)] }]
                }
              }
            }
          ],
          as: `${p}parent_tweet.bookmarks`
        }
      },
      {
        $lookup: {
          from: 'likes',
          let: { tweet_id: `$${p}parent_tweet._id` },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$tweet_id', '$$tweet_id'] }, { $eq: ['$user_id', new ObjectId(current_user_id)] }]
                }
              }
            }
          ],
          as: `${p}parent_tweet.likes`
        }
      },
      {
        $addFields: {
          [`${p}parent_tweet.is_bookmarked`]: {
            $cond: {
              if: { $gt: [{ $size: { $ifNull: [`$${p}parent_tweet.bookmarks`, []] } }, 0] },
              then: true,
              else: false
            }
          },
          [`${p}parent_tweet.is_liked`]: {
            $cond: {
              if: { $gt: [{ $size: { $ifNull: [`$${p}parent_tweet.likes`, []] } }, 0] },
              then: true,
              else: false
            }
          }
        }
      },
      {
        $project: {
          [`${p}parent_tweet.bookmarks`]: 0,
          [`${p}parent_tweet.likes`]: 0
        }
      }
    )
  }

  return stages
}

export const getIsRetweetedLookupStages = (user_id: string | null, prefix: string = '') => {
  if (!user_id) return []
  const p = prefix ? `${prefix}.` : ''
  const tweet_id_expr = prefix ? `$${prefix}._id` : '$_id'

  return [
    {
      $lookup: {
        from: 'tweets',
        let: { tweet_id: tweet_id_expr },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$parent_id', '$$tweet_id'] },
                  { $eq: ['$user_id', { $toObjectId: user_id }] },
                  { $eq: ['$type', 1] }
                ]
              }
            }
          }
        ],
        as: `${p}retweets`
      }
    },
    {
      $addFields: {
        [`${p}is_retweeted`]: {
          $cond: {
            if: { $gt: [{ $size: `$${p}retweets` }, 0] },
            then: true,
            else: false
          }
        }
      }
    },
    {
      $project: {
        [`${p}retweets`]: 0
      }
    }
  ]
}
