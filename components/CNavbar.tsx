import Button from "react-bootstrap/Button";
import Container from "react-bootstrap/Container";
import Navbar from "react-bootstrap/Navbar";
import Stack from "react-bootstrap/Stack";
import { useSession, signIn, signOut } from "next-auth/react";
function CNavbar() {
    return (
        <Navbar bg="light" expand="lg">
            <Container>
                <Stack gap={0}>
                    <Navbar.Brand href="/">SeederControl</Navbar.Brand>
                    <Navbar.Text>By BadPylot</Navbar.Text>
                </Stack>
                <AccountView/>
            </Container>
        </Navbar>
    );
}
function AccountView() {
    const {data, status} = useSession();
    function buttonAction() {
        (status == "unauthenticated") ? signIn("discord") : signOut();
    }
    return (
        <Stack direction="horizontal" gap={3}>
            {data?.userName}
            <Button disabled={(status == "loading")} onClick={buttonAction}>
                {(status == "unauthenticated") ? "Sign In" : "Sign Out"}
            </Button>
        </Stack>
    );
}
export default CNavbar;