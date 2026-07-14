import { NextResponse } from "next/server";
import { getProfile, setProfile } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getProfile());
}

export async function PUT(req: Request) {
  const body = await req.json();
  const profile = await setProfile(body);
  return NextResponse.json(profile);
}
