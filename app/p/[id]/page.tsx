import GradientApp from "@/components/GradientApp";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  return <GradientApp initialView="post" postId={(await params).id} />;
}
