import type {
  ArticleContext,
  ContentEdge,
  GraphContentNode,
  GraphContentNodeType,
  PageStructure,
  ThreadDoc,
  ThreadSemantics
} from "@threadatlas/shared"
import { hashUrl } from "@threadatlas/shared"

interface ThreadNode extends GraphContentNode {
  type: "thread"
  platform: "hn"
  threadDoc: ThreadDoc | null
  semantics: ThreadSemantics | null
  sourceArticleUrl: string | null
}

export class ContentGraphManager {
  private nodes = new Map<string, GraphContentNode>()
  private edges: ContentEdge[] = []

  addThread(threadDoc: ThreadDoc, articleUrl: string | null): string {
    const id = hashUrl(threadDoc.url)
    const node: ThreadNode = {
      id,
      url: threadDoc.url,
      title: threadDoc.title,
      type: "thread",
      platform: "hn",
      threadDoc,
      semantics: null,
      sourceArticleUrl: articleUrl,
      snapshot: null
    }

    this.nodes.set(id, node)

    if (articleUrl) {
      this.edges.push({
        from: hashUrl(articleUrl),
        to: id,
        relation: "triggers"
      })
    }

    return id
  }

  setThreadSemantics(threadUrl: string, semantics: ThreadSemantics): void {
    const node = this.nodes.get(hashUrl(threadUrl)) as ThreadNode | undefined
    if (!node) {
      return
    }
    node.semantics = semantics
  }

  addArticle(
    url: string,
    title: string,
    text: string,
    structure: PageStructure,
    extractedAt = Date.now()
  ): string {
    const id = hashUrl(url)
    this.nodes.set(id, {
      id,
      url,
      title,
      type: "article" as GraphContentNodeType,
      snapshot: {
        text,
        structure,
        extractedAt
      }
    })

    return id
  }

  getSourceArticle(threadId: string): ArticleContext | null {
    const thread = this.nodes.get(threadId) as ThreadNode | undefined
    if (!thread?.sourceArticleUrl) {
      return null
    }

    const article = this.nodes.get(hashUrl(thread.sourceArticleUrl))
    if (!article?.snapshot) {
      return null
    }

    return {
      url: article.url,
      title: article.title,
      text: article.snapshot.text,
      structure: article.snapshot.structure,
      readAt: article.snapshot.extractedAt
    }
  }
}
