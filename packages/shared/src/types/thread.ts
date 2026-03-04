export interface Comment {
  id: string
  author: string
  text: string
  depth: number
  score: number | null
  parentId: string | null
  timestamp: number
}

export interface ThreadDoc {
  url: string
  title: string
  submitter: string
  score: number
  comments: Comment[]
}
