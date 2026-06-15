import { redirect } from "next/navigation"

// The standalone changes list is retired; its approved/implemented/verified view is
// now a status filter on the requests table. Preserve old links.
export default function ChangesIndex() {
  redirect("/requests?status=approved,implemented,verified")
}
