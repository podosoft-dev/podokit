export type FaqItem = {
  id: string;
  question: string;
  answer: string;
  category: string;
  order: number;
  published: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
};
