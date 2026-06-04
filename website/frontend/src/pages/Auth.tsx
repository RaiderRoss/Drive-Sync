import { useLocation, useNavigate } from "react-router-dom";
import { Card, Form, Input, Button, Typography, message, Divider, Space } from "antd";
import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { PasswordStrength } from "../Components/passwordStrength";
import { EyeInvisibleOutlined, EyeTwoTone } from "@ant-design/icons";

const { Title, Text } = Typography;

export default function Auth() {
    const location = useLocation();
    const navigate = useNavigate();
    const { login, register } = useAuth();

    const isLoginRoute = location.pathname === "/login";

    const [mode, setMode] = useState<"login" | "register">(
        isLoginRoute ? "login" : "register"
    );
    const [registerForm] = Form.useForm();
    const passwordValue = Form.useWatch("password", registerForm) || "";

    const strengthChecks = {
        has8Characters: passwordValue.length >= 8,
        hasLowercase: /[a-z]/.test(passwordValue),
        hasUppercase: /[A-Z]/.test(passwordValue),
        hasNumber: /\d/.test(passwordValue),
        hasSpecial: /[^A-Za-z0-9]/.test(passwordValue),
    };

    const strengthValue = [
        strengthChecks.has8Characters,
        strengthChecks.hasLowercase,
        strengthChecks.hasUppercase,
        strengthChecks.hasNumber,
        strengthChecks.hasSpecial,
    ].filter(Boolean).length * 20;

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
                padding: 24,
               background: "linear-gradient(135deg, #1c1c1c 0%, #1a2030 45%, #202731 100%)",
            }}
        >
            <div style={{ width: 420, maxWidth: "100%", overflow: "hidden" }}>
                <div
                    style={{
                        display: "flex",
                        width: "200%",
                        transform:
                            mode === "login" ? "translateX(0%)" : "translateX(-50%)",
                        transition: "transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)",
                    }}
                >

                    <Card
                        style={{
                            width: "50%",
                            borderRadius: 24,
                            display: "flex",
                            flexDirection: "column",
                            minHeight: 520,
                            backdropFilter: "blur(12px)",
                        }}
                        styles={{ body: { padding: 28, height: "100%" } }}
                    >
                        <Space direction="vertical" size={8} style={{ width: "100%", marginBottom: 10 }}>
                            <Typography.Text style={{ color: "#8c8c8c", letterSpacing: 1.4, textTransform: "uppercase", fontSize: 12 }}>
                                Welcome back
                            </Typography.Text>
                            <Title level={3} style={{ color: "white", margin: 0 }}>
                                Login
                            </Title>
                            <Typography.Text style={{ color: "#9aa4b2" }}>
                                Continue to your workspace.
                            </Typography.Text>
                        </Space>

                        <Divider style={{ borderColor: "rgba(255,255,255,0.08)", margin: "16px 0 24px" }} />

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
                                <Input.Password autoComplete="current-password" iconRender={(visible) =>
                                    visible ? (
                                        <EyeTwoTone twoToneColor="#fff" />
                                    ) : (
                                        <EyeInvisibleOutlined style={{ color: "#fff" }} />
                                    )
                                } />
                            </Form.Item>

                            <Button type="primary" block htmlType="submit">
                                Login
                            </Button>
                        </Form>

                        <div style={{ position: "absolute", bottom: 18, left: 0, right: 0, textAlign: "center" }}>
                            <span style={{ color: "#8c8c8c" }}>No account?</span>{" "}
                            <Button
                                type="link"
                                onClick={() => {
                                    setMode("register");
                                    navigate("/register");
                                }}
                                style={{ marginLeft: 8 }}
                            >
                                Sign up
                            </Button>
                        </div>
                    </Card>

                    <Card
                        style={{
                            width: "50%",
                            borderRadius: 24,
                            display: "flex",
                            flexDirection: "column",
                            minHeight: 620,
                            backdropFilter: "blur(12px)",
                        }}
                        styles={{ body: { padding: 28, height: "100%" } }}
                    >
                        <Space direction="vertical" size={8} style={{ width: "100%", marginBottom: 10 }}>
                            <Typography.Text style={{ color: "#8c8c8c", letterSpacing: 1.4, textTransform: "uppercase", fontSize: 12 }}>
                                Create account
                            </Typography.Text>
                            <Title level={3} style={{ color: "white", margin: 0 }}>
                                Register
                            </Title>
                            <Typography.Text style={{ color: "#9aa4b2" }}>
                                Set up your account in a minute.
                            </Typography.Text>
                        </Space>

                        <Divider style={{ borderColor: "rgba(255,255,255,0.08)", margin: "16px 0 24px" }} />

                        <Form form={registerForm} layout="vertical" style={{ flex: 1 }} onFinish={handleRegister}>
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
                                <Input.Password autoComplete="new-password" iconRender={(visible) =>
                                    visible ? (
                                        <EyeTwoTone twoToneColor="#fff" />
                                    ) : (
                                        <EyeInvisibleOutlined style={{ color: "#fff" }} />
                                    )
                                } />
                            </Form.Item>

                            <div style={{ marginBottom: 16 }}>
                                <PasswordStrength
                                    value={strengthValue}
                                    {...strengthChecks}
                                />
                            </div>

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
                                <Input.Password autoComplete="new-password" iconRender={(visible) =>
                                    visible ? (
                                        <EyeTwoTone twoToneColor="#fff" />
                                    ) : (
                                        <EyeInvisibleOutlined style={{ color: "#fff" }} />
                                    )
                                } />
                            </Form.Item>

                            <Button type="primary" block htmlType="submit">
                                Create account
                            </Button>
                        </Form>

                        <div style={{ position: "absolute", bottom: 18, left: 0, right: 0, textAlign: "center" }}>
                            <Text style={{ color: "#8c8c8c" }}>
                                Already have an account?
                            </Text>{" "}
                            <Button
                                type="link"
                                onClick={() => {
                                    setMode("login");
                                    navigate("/login");
                                }}
                                style={{ marginLeft: 8 }}
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