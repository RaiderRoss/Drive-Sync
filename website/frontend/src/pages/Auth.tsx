import { useLocation, useNavigate } from "react-router-dom";
import { Card, Form, Input, Button, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";

const { Title, Text } = Typography;

export default function Auth() {
    const location = useLocation();
    const navigate = useNavigate();
    const { login, register } = useAuth();

    const isLoginRoute = location.pathname === "/login";

    const [mode, setMode] = useState<"login" | "register">(
        isLoginRoute ? "login" : "register"
    );

    useEffect(() => {
        setMode(isLoginRoute ? "login" : "register");
    }, [isLoginRoute]);

    const handleLogin = async (values: { username: string; password: string }) => {
        try {
            await login(values.username, values.password);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Login failed");
        }
    };

    const handleRegister = async (values: { username: string; password: string }) => {
        try {
            await register(values.username, values.password);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Registration failed");
        }
    };

    return (
        <div
            style={{
                height: "100vh",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                background: "#141414",
            }}
        >
            <div style={{ width: 380, overflow: "hidden" }}>
                <div
                    style={{
                        display: "flex",
                        width: "200%",
                        transform:
                            mode === "login" ? "translateX(0%)" : "translateX(-50%)",
                        transition: "0.4s ease",
                    }}
                >

                    <Card
                        style={{
                            width: "50%",
                            background: "#1f1f1f",
                            borderColor: "#2d2d2d",
                            display: "flex",
                            flexDirection: "column",
                            minHeight: 420,
                        }}
                    >
                        <Title level={3} style={{ color: "white" }}>
                            Login
                        </Title>

                        <Form layout="vertical" style={{ flex: 1 }} onFinish={handleLogin}>
                            <Form.Item
                                name="username"
                                label={<span style={{ color: "#ccc" }}>Username</span>}
                                rules={[{ required: true, message: "Enter your username" }]}
                            >
                                <Input autoComplete="username" />
                            </Form.Item>

                            <Form.Item
                                name="password"
                                label={<span style={{ color: "#ccc" }}>Password</span>}
                                rules={[{ required: true, message: "Enter your password" }]}
                            >
                                <Input.Password autoComplete="current-password" />
                            </Form.Item>

                            <Button type="primary" block htmlType="submit">
                                Login
                            </Button>
                        </Form>
                        
                        <div style={{ position: "absolute", bottom: 18, left: 0, right: 0, textAlign: "center" }}>
                            <span style={{ color: "#aaa" }}>No account?</span>{" "}
                            <Button
                                type="link"
                                onClick={() => {
                                    setMode("register");
                                    navigate("/register");
                                }}
                            >
                                Sign up
                            </Button>
                        </div>
                    </Card>

                    {/* REGISTER */}
                    <Card
                        style={{
                            width: "50%",
                            background: "#1f1f1f",
                            borderColor: "#2d2d2d",
                            display: "flex",
                            flexDirection: "column",
                            minHeight: 420,
                        }}
                    >
                        <Title level={3} style={{ color: "white" }}>
                            Register
                        </Title>

                        <Form layout="vertical" style={{ flex: 1 }} onFinish={handleRegister}>
                            <Form.Item
                                name="username"
                                label={<span style={{ color: "#ccc" }}>Username</span>}
                                rules={[{ required: true, message: "Enter a username" }]}
                            >
                                <Input autoComplete="username" />
                            </Form.Item>

                            <Form.Item
                                name="password"
                                label={<span style={{ color: "#ccc" }}>Password</span>}
                                rules={[{ required: true, message: "Enter a password" }]}
                            >
                                <Input.Password autoComplete="new-password" />
                            </Form.Item>

                            <Form.Item
                                name="confirmPassword"
                                label={<span style={{ color: "#ccc" }}>Confirm Password</span>}
                                dependencies={["password"]}
                                rules={[
                                    { required: true, message: "Confirm your password" },
                                    ({ getFieldValue }) => ({
                                        validator(_, value) {
                                            if (!value || getFieldValue("password") === value) {
                                                return Promise.resolve();
                                            }

                                            return Promise.reject(new Error("Passwords do not match"));
                                        },
                                    }),
                                ]}
                            >
                                <Input.Password autoComplete="new-password" />
                            </Form.Item>

                            <Button type="primary" block htmlType="submit">
                                Create account
                            </Button>
                        </Form>

                        <div style={{position: "absolute", bottom: 18, left: 0, right: 0, textAlign: "center" }}>
                            <Text style={{ color: "#aaa" }}>
                                Already have an account?
                            </Text>{" "}
                            <Button
                                type="link"
                                onClick={() => {
                                    setMode("login");
                                    navigate("/login");
                                }}
                            >
                                Login
                            </Button>
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}