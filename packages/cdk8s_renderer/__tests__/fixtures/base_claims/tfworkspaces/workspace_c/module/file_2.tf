# This is a test comment for the file_2.tf file

resource "aws_instance" "other" {
  ami           = "ami-830c94e3"
  instance_type = "t2.micro"

  tags = {
    Name = "ExampleAppServerInstance"
  }
}
